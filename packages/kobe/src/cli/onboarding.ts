/**
 * First-run onboarding — the framework-free half.
 *
 * A bare `kobe` on a TTY runs the inline wizard once
 * (`src/tui-react/onboarding/host.tsx` collects the answers), then this
 * module APPLIES them after the renderer is torn down: hook shell
 * completions into the user's rc file, optionally run the agent-skill
 * installer (npx, inherits the terminal), print the environment summary and
 * ready banner, and persist the flags so it never runs again. Every install
 * is re-runnable later (`kobe completions --help`, `kobe skill install`), so
 * declining is always safe.
 *
 * Two flags, two guarantees: `onboarded` is set BEFORE the wizard renders, so
 * a killed wizard never re-asks the questions; `onboardedPrimer` is set only
 * when the wizard RESOLVES, so a killed wizard (which never reached the
 * "Keyboard basics" page) re-runs once in primer mode — just the environment
 * page and the keyboard page, no questions.
 */

import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { isNpxMissing, markSkillHintSeen, npxSkillsArgv, npxSkillsCommand } from "../lib/skill-install.ts"
import { getPersistedBool, setPersistedBool } from "../state/store.ts"
import { t } from "../tui/i18n"
import { type OnboardingEnvReport, checkOnboardingEnv } from "./env-checks.ts"
import { activeCliName } from "./rename-compat.ts"

const ONBOARDED_KEY = "onboarded"
const PRIMER_KEY = "onboardedPrimer"

export type ShellKind = "zsh" | "bash" | "fish"

/** The wizard's answers; a skipped wizard (q/esc) declines everything. */
export interface OnboardingChoices {
  readonly completions: boolean
  readonly skill: boolean
}

/** Detect the user's shell from $SHELL; null = unknown (step is skipped). */
export function detectShell(env: NodeJS.ProcessEnv = process.env): ShellKind | null {
  const shell = basename(env.SHELL ?? "")
  return shell === "zsh" || shell === "bash" || shell === "fish" ? shell : null
}

/**
 * Hook completions into the shell, returning the file that was touched.
 * zsh/bash get one guarded `source <(<cli> completions <shell>)` line in
 * their rc file (the generated zsh script self-registers via compdef when
 * sourced); fish gets a lazy one-liner completions file, which fish
 * autoloads with no rc edit. All three re-generate from the live binary,
 * so completions never go stale across updates.
 */
export function installCompletions(shell: ShellKind, home: string = homedir(), cli: string = activeCliName()): string {
  const rcMarker = `${cli} completions`
  if (shell === "fish") {
    const dir = join(home, ".config", "fish", "completions")
    const path = join(dir, `${cli}.fish`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, `${cli} completions fish | source\n`)
    return path
  }
  const rc = join(home, shell === "zsh" ? ".zshrc" : ".bashrc")
  const existing = existsSync(rc) ? readFileSync(rc, "utf8") : ""
  if (!existing.includes(rcMarker)) {
    const line = `\n# ${cli} completions\ncommand -v ${cli} >/dev/null && source <(${cli} completions ${shell})\n`
    appendFileSync(rc, line)
  }
  return rc
}

export function isOnboarded(): boolean {
  return getPersistedBool(ONBOARDED_KEY, false)
}

export function markOnboarded(): void {
  setPersistedBool(ONBOARDED_KEY, true)
}

/** The "Keyboard basics" page (and primer-mode re-run) was delivered. */
export function isPrimerDone(): boolean {
  return getPersistedBool(PRIMER_KEY, false)
}

function markPrimerDone(): void {
  setPersistedBool(PRIMER_KEY, true)
}

/**
 * True when the machine can actually run a first task: at least one usable
 * engine AND git (worktrees need it). The same gates doctor proposes fixes
 * for, so the closing banner and `rove doctor` tell one story.
 */
export function envReadyForTasks(env: OnboardingEnvReport): boolean {
  return env.engines.anyUsable && env.git.found
}

/**
 * Apply the wizard's answers and print the closing summary. Runs AFTER the
 * inline renderer is destroyed — the skill installer inherits the real
 * terminal (npx prompts/progress), and the summary lands in scrollback. The
 * environment report (`git` + `engines`) renders either way: it is the
 * difference between "You're ready to go!" and an honest list of what is
 * missing and how to fix it — the remediation lines are doctor's own.
 */
export function applyOnboardingChoices(
  choices: OnboardingChoices,
  shell: ShellKind | null,
  env: OnboardingEnvReport,
): void {
  const cli = activeCliName()
  const completionsHelp = `${cli} completions --help`
  const skillInstall = `${cli} skill install`
  const out = (line: string) => process.stdout.write(`${line}\n`)
  if (shell !== null) {
    if (choices.completions) {
      out(t("onboarding.appliedCompletions", { path: installCompletions(shell) }))
    } else {
      out(t("onboarding.skippedCompletions", { command: completionsHelp }))
    }
  }
  if (choices.skill) {
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
  } else {
    out(t("onboarding.skippedSkill", { command: skillInstall }))
    // The user just answered this question. Suppress the one-time startup
    // hint so the next `rove` doesn't ask it again on stderr.
    markSkillHintSeen()
  }
  out("")
  out(env.git.line)
  for (const line of env.engines.lines) out(line)
  out("")
  if (envReadyForTasks(env)) {
    out(t("onboarding.ready"))
    // The package ships BOTH bins; every other line here interpolates the name
    // the user actually invoked, so this one must too.
    out(t("onboarding.readyHint", { command: cli }))
  } else {
    out(t("onboarding.notReadyHeader"))
    if (!env.engines.anyUsable) out(`  → ${t("doctor.fix.noEngineAction")}`)
    if (!env.git.found) out(`  → ${t("doctor.fix.gitAction")}`)
  }
}

/**
 * The bare-`kobe` gate: on a first interactive launch, run the wizard and
 * return true (the caller exits instead of starting the TUI — the wizard
 * ends with "run `kobe`" so the next launch lands in the app). Returns false
 * when onboarding already happened or there's no TTY to ask on.
 *
 * `onboarded` alone never gates entry here — it is set before the wizard
 * renders, so a killed wizard leaves it set with the primer undelivered.
 * That launch re-runs in "primer" mode: no questions (a killed wizard must
 * never re-ask), just the environment page and the keyboard page.
 */
export async function maybeRunOnboarding(): Promise<boolean> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) return false
  const seen = isOnboarded()
  if (seen && isPrimerDone()) return false
  // Mark BEFORE anything runs: a killed/EOF'd/crashed wizard (or a failed npx
  // afterwards) must never re-trigger the questions — one showing, ever,
  // same never-nag rule as maybeHintSkillInstall.
  markOnboarded()
  const shell = detectShell()
  const env = await checkOnboardingEnv()
  const { runOnboardingWizard } = await import("../tui-react/onboarding/host.tsx")
  const choices = await runOnboardingWizard(shell, env, seen ? "primer" : "full")
  // Reaching here the wizard RESOLVED (enter/q/esc all resolve) — only a
  // process kill leaves the primer undelivered, and that is the one case
  // that re-runs.
  markPrimerDone()
  applyOnboardingChoices(choices, shell, env)
  return true
}
