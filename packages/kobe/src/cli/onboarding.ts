/**
 * First-run welcome — the framework-free half.
 *
 * The dialog (`src/tui-react/onboarding/host.tsx`) collects the answers over
 * the live workspace; this module owns everything that touches disk or spawns
 * a process. The split is not cosmetic: a dialog resolves while the TUI still
 * owns the screen, so NOTHING here may write to stdout at that moment — a
 * stray line repaints over the renderer's cells and corrupts the frame.
 *
 * So both answers are RECORDED when the dialog resolves and APPLIED after
 * `startTui()` returns, when the terminal is plain again:
 *
 *   - completions is a filesystem write, and could technically run either
 *     way — it is deferred anyway so its summary line lands next to the
 *     skill installer's instead of vanishing behind the TUI.
 *   - the skill installer is `npx`: it wants a real terminal for prompts and
 *     progress, and inherits one only once the renderer is gone.
 *
 * Every install is re-runnable later (`rove completions --help`,
 * `rove skill install`), so declining is always safe.
 */

import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { isNpxMissing, markSkillHintSeen, npxSkillsArgv, npxSkillsCommand } from "../lib/skill-install.ts"
import type { ProductCliName } from "../product.ts"
import { loadStateFile, patchStateFile } from "../state/store.ts"
import type { OnboardingChoices } from "../tui-react/onboarding/host.tsx"
import { t } from "../tui/i18n"
import { type ShellKind, shippedCompletionsPath } from "./completion-scripts.ts"
import { activeCliName } from "./rename-compat.ts"
import { PENDING_SKILL_KEY } from "./welcome.ts"

/** Completions the user accepted, deferred for the same reason as the skill. */
const PENDING_COMPLETIONS_KEY = "welcomePendingCompletions"

/** Detect the user's shell from $SHELL; null = unknown (step is skipped). */
export function detectShell(env: NodeJS.ProcessEnv = process.env): ShellKind | null {
  const shell = basename(env.SHELL ?? "")
  return shell === "zsh" || shell === "bash" || shell === "fish" ? shell : null
}

/**
 * The hook line for one shell, given the pre-generated script (or null).
 *
 * Sourced from the shipped file the shell starts nothing: the guard is a
 * `test -f`, not a subprocess. Without one (a source checkout, which has no
 * `dist/completions`) the old live line stands — correct, but it pays a
 * process per shell.
 */
function completionHook(shell: ShellKind, cli: ProductCliName, shipped: string | null): string {
  if (shipped === null) return legacyCompletionHook(shell, cli)
  // fish spells the guard `test ...; and ...`; bash and zsh both take `[ ] &&`.
  return shell === "fish"
    ? `test -f "${shipped}"; and source "${shipped}"`
    : `[ -f "${shipped}" ] && source "${shipped}"`
}

/** What rove wrote before the scripts were pre-generated: regenerates, but spawns. */
function legacyCompletionHook(shell: ShellKind, cli: ProductCliName): string {
  return shell === "fish"
    ? `${cli} completions fish | source`
    : `command -v ${cli} >/dev/null && source <(${cli} completions ${shell})`
}

/** The pre-generated script for this shell; null when nothing is built. */
function shippedScriptFor(shell: ShellKind, cli: ProductCliName): string | null {
  const path = shippedCompletionsPath(shell, cli)
  return existsSync(path) ? path : null
}

/** What {@link installCompletions} did. */
export interface CompletionInstall {
  /** The rc file (or fish autoload file) the hook lives in. */
  readonly path: string
  /**
   * False when the file already covered this shell, so nothing was written —
   * the caller must not claim it installed something. A hand-rolled
   * `# <cli> completions` block the user wrote themselves lands here too:
   * their file, their line, never clobbered.
   */
  readonly installed: boolean
}

/**
 * Hook completions into the shell, returning the file it touched and whether
 * this call wrote it. zsh/bash get one `source "<shipped script>"` line in
 * their rc file (the generated zsh script self-registers via compdef when
 * sourced); fish gets a one-liner in its autoload directory, which fish reads
 * with no rc edit.
 *
 * `shipped` defaults to the script generated beside the installed bundle, so
 * completions track the binary that owns them and can never go stale.
 */
export function installCompletions(
  shell: ShellKind,
  home: string = homedir(),
  cli: ProductCliName = activeCliName(),
  shipped: string | null = shippedScriptFor(shell, cli),
): CompletionInstall {
  const hook = completionHook(shell, cli, shipped)
  if (shell === "fish") {
    const dir = join(home, ".config", "fish", "completions")
    const path = join(dir, `${cli}.fish`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, `${hook}\n`)
    return { path, installed: true }
  }
  const rc = join(home, shell === "zsh" ? ".zshrc" : ".bashrc")
  const existing = existsSync(rc) ? readFileSync(rc, "utf8") : ""
  if (existing.includes(hook)) return { path: rc, installed: false }
  // An install from before the pre-generated files: upgrade that one line in
  // place rather than deciding the user is already hooked.
  const legacy = legacyCompletionHook(shell, cli)
  if (existing.includes(legacy)) {
    writeFileSync(rc, existing.replace(legacy, hook))
    return { path: rc, installed: true }
  }
  // Anything else mentioning `<cli> completions` is the user's own block.
  if (existing.includes(`${cli} completions`)) return { path: rc, installed: false }
  appendFileSync(rc, `\n# ${cli} completions\n${hook}\n`)
  return { path: rc, installed: true }
}

/**
 * Record the dialog's answers for {@link runPendingWelcomeInstalls}.
 *
 * Called while the TUI still owns the screen, so this writes state and
 * nothing else — no stdout, no spawn. A declined skill also settles the
 * one-time startup hint: the user just answered that exact question, and the
 * next launch must not ask it again on stderr.
 */
export function recordWelcomeChoices(choices: OnboardingChoices, shell: ShellKind | null): void {
  if (!choices.skill) markSkillHintSeen()
  try {
    patchStateFile({
      [PENDING_COMPLETIONS_KEY]: choices.completions && shell !== null ? shell : undefined,
      [PENDING_SKILL_KEY]: choices.skill ? true : undefined,
    })
  } catch {
    // A read-only home loses the deferred install, not the session.
  }
}

/**
 * Apply whatever the welcome dialog recorded, then clear it. Runs AFTER the
 * renderer is destroyed — the skill installer inherits the real terminal
 * (npx prompts/progress) and every summary line lands in scrollback.
 *
 * A no-op for the overwhelming majority of launches: only the run right
 * after a first-run dialog has anything pending.
 */
export function runPendingWelcomeInstalls(): void {
  const state = loadStateFile()
  const shell = state[PENDING_COMPLETIONS_KEY]
  const wantsSkill = state[PENDING_SKILL_KEY] === true
  const pendingShell = typeof shell === "string" ? (shell as ShellKind) : null
  if (pendingShell === null && !wantsSkill) return

  try {
    patchStateFile({ [PENDING_COMPLETIONS_KEY]: undefined, [PENDING_SKILL_KEY]: undefined })
  } catch {
    // Clearing is best-effort; a failed clear re-runs an idempotent install.
  }

  const cli = activeCliName()
  const out = (line: string) => process.stdout.write(`${line}\n`)
  if (pendingShell !== null) {
    const completion = installCompletions(pendingShell)
    out(
      t(completion.installed ? "onboarding.appliedCompletions" : "onboarding.keptCompletions", {
        path: completion.path,
      }),
    )
  }
  if (wantsSkill) {
    const skillInstall = `${cli} skill install`
    if (isNpxMissing()) {
      // The install.sh path in the QUICKSTART installs Bun and Rove but never
      // Node, so a missing `npx` is ordinary here. Say what's missing instead
      // of pointing at `rove skill install`, which needs the same binary.
      out(t("onboarding.skillNeedsNode", { command: skillInstall }))
    } else {
      out(t("onboarding.installingSkill", { command: npxSkillsCommand() }))
      const result = spawnSync("npx", npxSkillsArgv(), { stdio: "inherit" })
      if (result.status !== 0) out(t("onboarding.skillFailed", { command: skillInstall }))
    }
  }
}
