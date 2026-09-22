/**
 * First-run welcome — the disk/process half (the dialog is
 * `tui-react/onboarding/host.tsx`). The dialog resolves while the TUI owns
 * the screen, where any stdout line corrupts the frame, so answers are
 * RECORDED then and APPLIED after `startTui()` returns: the `npx` skill
 * installer needs a real terminal, and completions are deferred so their
 * summary line lands beside it. Both are re-runnable later
 * (`rove completions --help`, `rove skill install`).
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
 * The hook line for one shell. Sourcing the shipped script spawns nothing;
 * without one (a source checkout has no `dist/completions`) the live line
 * costs a process per shell.
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
  /** False when the file already covered this shell (including a user's own
   *  `<cli> completions` block, never clobbered) and nothing was written. */
  readonly installed: boolean
}

/**
 * Hook completions into the shell: one source line in the zsh/bash rc (the
 * zsh script self-registers via compdef), or a fish autoload file (no rc
 * edit). `shipped` defaults to the script beside the installed bundle, so
 * completions track their binary and never go stale.
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
  // Upgrade a legacy hook line in place.
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
 * Record the dialog's answers for {@link runPendingWelcomeInstalls}. Runs
 * while the TUI owns the screen: state writes only, no stdout, no spawn. A
 * declined skill also settles the one-time startup hint so it isn't re-asked.
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

/** Apply and clear what the welcome dialog recorded. Runs AFTER the renderer is destroyed. */
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
      // install.sh never installs Node, so no `npx` is ordinary; don't point
      // at `rove skill install`, which needs it too.
      out(t("onboarding.skillNeedsNode", { command: skillInstall }))
    } else {
      out(t("onboarding.installingSkill", { command: npxSkillsCommand() }))
      const result = spawnSync("npx", npxSkillsArgv(), { stdio: "inherit" })
      if (result.status !== 0) out(t("onboarding.skillFailed", { command: skillInstall }))
    }
  }
}
