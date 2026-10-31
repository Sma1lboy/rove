/**
 * First-run welcome — the disk/process half (the dialog is
 * `tui-react/onboarding/host.tsx`). The dialog resolves while the TUI owns
 * the screen, where any stdout line corrupts the frame, so answers are
 * applied silently: the skill is a file copy done on the spot, and
 * completions are RECORDED then and APPLIED after `startTui()` returns so
 * their summary line reaches a real terminal. Both are re-runnable later
 * (`rove completions --help`, `rove skill install`).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { installSkill, skillTargets } from "../lib/skill-install.ts"
import type { ProductCliName } from "../product.ts"
import { ROVE_PRODUCT_NAME } from "../product.ts"
import { loadStateFile, patchStateFile } from "../state/store.ts"
import type { OnboardingChoices } from "../tui-react/onboarding/host.tsx"
import { t } from "../tui/i18n"
import { type ShellKind, isShellKind, shippedCompletionsPath } from "./completion-scripts.ts"

/** Completions the user accepted, deferred until the TUI releases the terminal. */
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
  cli: ProductCliName = ROVE_PRODUCT_NAME,
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

/** Outcome of the welcome skill install, as recorded in state. */
function installSkillNow(): { status: "succeeded" } | { status: "failed"; reason: string } {
  try {
    const targets = skillTargets()
    if (targets.length === 0) return { status: "failed", reason: "no supported coding agent found" }
    const failed = installSkill(targets).filter((r) => r.error)
    return failed.length === 0
      ? { status: "succeeded" }
      : { status: "failed", reason: failed.map((r) => `${r.target.displayName}: ${r.error}`).join("; ") }
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Apply the dialog's answers. Runs while the TUI owns the screen: file and
 * state writes only, no stdout. The skill installs now; completions are
 * queued for {@link runPendingWelcomeInstalls}.
 */
export function recordWelcomeChoices(choices: OnboardingChoices, shell: ShellKind | null): void {
  const skill = choices.skill ? installSkillNow() : undefined
  try {
    patchStateFile({
      [PENDING_COMPLETIONS_KEY]: choices.completions && shell !== null ? shell : undefined,
      "welcomeInstall.completions": choices.completions ? { status: "queued" } : undefined,
      "welcomeInstall.skill": skill,
    })
  } catch {
    // A read-only home loses the deferred install, not the session.
  }
}

/** Apply and clear what the welcome dialog recorded. Runs AFTER the renderer is destroyed. */
export function runPendingWelcomeInstalls(): void {
  const state = loadStateFile()
  const shell = state[PENDING_COMPLETIONS_KEY]
  const pendingShell = typeof shell === "string" && isShellKind(shell) ? shell : null
  if (shell !== undefined && pendingShell === null) {
    process.stdout.write(
      "! Ignoring invalid pending completion shell; run rove completions --help to choose a supported shell.\n",
    )
    try {
      patchStateFile({
        [PENDING_COMPLETIONS_KEY]: undefined,
        "welcomeInstall.completions": { status: "failed", reason: "Unsupported shell" },
      })
    } catch {
      /* Read-only settings must not block the remaining setup. */
    }
  }
  if (pendingShell === null) return

  const cli = ROVE_PRODUCT_NAME
  const out = (line: string) => process.stdout.write(`${line}\n`)
  const save = (patch: Record<string, unknown>) => {
    try {
      patchStateFile(patch)
    } catch {
      out("! Could not save setup results; check permissions before retrying.")
    }
  }
  const failed = (item: string, reason: string, command: string) => {
    save({ [`welcomeInstall.${item}`]: { status: "failed", reason } })
    out(t("onboarding.installFailed", { item, reason, command }))
  }
  if (pendingShell !== null) {
    try {
      const completion = installCompletions(pendingShell)
      save({
        [PENDING_COMPLETIONS_KEY]: undefined,
        "welcomeInstall.completions": { status: "succeeded" },
      })
      out(
        t(completion.installed ? "onboarding.appliedCompletions" : "onboarding.keptCompletions", {
          path: completion.path,
        }),
      )
    } catch (error) {
      failed(
        "completions",
        error instanceof Error ? error.message : String(error),
        `${cli} completions ${pendingShell} --install`,
      )
    }
  }
}

/** A successful explicit retry satisfies the matching queued setup request. */
export function settleWelcomeInstall(item: "completions", shell?: ShellKind): void {
  const state = loadStateFile()
  if (state[PENDING_COMPLETIONS_KEY] !== shell) return
  try {
    patchStateFile({ [PENDING_COMPLETIONS_KEY]: undefined, [`welcomeInstall.${item}`]: { status: "succeeded" } })
  } catch {
    process.stderr.write("! Setup succeeded, but its queued state could not be saved. Check settings permissions.\n")
  }
}
