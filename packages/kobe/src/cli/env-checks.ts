/**
 * Read-only environment probes shared by `rove doctor` and the first-run
 * onboarding wizard: is git on PATH, and can any registered engine actually
 * run a task (binary present + account where detectable). One implementation
 * so the wizard's third page and `rove doctor` can never disagree about the
 * same machine. `doctor-cmd.ts` owns presentation of the full report; the
 * wizard owns its page.
 */

import type { BinaryStatus } from "../engine/account-detect.ts"
import { listPresetIds } from "../engine/engine-presets.ts"
import { describeAccount, detectEngineStatuses, engineUsable } from "../engine/engine-status.ts"

export interface GitProbeResult {
  /** The doctor-formatted one-liner (`git: ✓ …` / `git: ✗ …`). */
  readonly line: string
  readonly found: boolean
}

export interface EngineProbeResult {
  /** The doctor-formatted block (`engines:` header + one row per engine). */
  readonly lines: string[]
  /** True when at least one engine could actually run a task right now. */
  readonly anyUsable: boolean
}

/** What the onboarding wizard's environment page and closing banner render. */
export interface OnboardingEnvReport {
  readonly git: GitProbeResult
  readonly engines: EngineProbeResult
}

/** `git --version` if git is on PATH, else a not-found marker. */
export async function probeGit(): Promise<GitProbeResult> {
  try {
    const proc = Bun.spawn(["git", "--version"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" })
    const text = (await new Response(proc.stdout).text()).trim()
    if ((await proc.exited) === 0 && text) return { line: `git:      ✓ ${text}`, found: true }
  } catch {
    // fall through to not-found
  }
  return { line: "git:      ✗ not found on PATH", found: false }
}

function binaryLabel(binary: BinaryStatus): string {
  return binary.found ? `✓ ${binary.path}` : `✗ ${binary.error}`
}

/**
 * One "engines:" block: per-engine CLI binary + account state (read-only).
 *
 * Loops over the REGISTERED engines rather than a fixed set of rows: a fixed
 * set hides an engine that ships a real account detector, and a contrib or
 * custom engine can never reach it at all without editing a neutral CLI file.
 * `detectEngineStatuses` is the same probe Settings →
 * Accounts uses, so the two surfaces can't disagree.
 *
 * Order is `listPresetIds()`: the built-ins in their stable cycle order
 * (claude, codex, copilot, kimi), then the user's own presets in registration
 * order.
 */
export async function probeEngines(): Promise<EngineProbeResult> {
  const statuses = await detectEngineStatuses(listPresetIds())
  const lines = ["engines:"]
  for (const status of statuses) {
    const account = describeAccount(status.account)
    // padEnd(7)+space, not padEnd(8): a custom id of exactly 8 chars would
    // otherwise butt straight against the ✓/✗. Built-in columns are unchanged.
    const name = `${status.vendor.padEnd(7)} `
    lines.push(`  ${name}${binaryLabel(status.binary)}${status.binary.found ? ` — ${account}` : ""}`)
    if (status.accountError) lines.push(`          ⚠ ${status.accountError}`)
  }
  // "Usable" = binary present AND some account. One usable engine is enough;
  // a missing vendor the user never launches is not a finding.
  return { lines, anyUsable: statuses.some(engineUsable) }
}

/**
 * The wizard's pre-flight: both probes in parallel. Runs BEFORE the wizard
 * renders, so the environment page is static text and a killed wizard never
 * leaves a probe half-printed.
 */
export async function checkOnboardingEnv(): Promise<OnboardingEnvReport> {
  const [git, engines] = await Promise.all([probeGit(), probeEngines()])
  return { git, engines }
}
