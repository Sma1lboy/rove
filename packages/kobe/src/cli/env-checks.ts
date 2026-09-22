/**
 * Read-only environment probes behind `rove doctor`: is git on PATH, and can
 * any registered engine actually run a task (binary present + account where
 * detectable). `doctor-cmd.ts` owns presentation of the full report.
 */

import type { BinaryStatus } from "../engine/account-detect.ts"
import { describeAccount, detectEngineStatuses, probeableEngineIds, summarizeEngines } from "../engine/engine-status.ts"

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
  /** Installed engines whose readable login says "no account". Empty with
   *  `anyUsable: false` = nothing installed — a different remedy. */
  readonly signedOut: readonly string[]
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
 * The "engines:" block: binary + account per REGISTERED engine (not a fixed
 * row set, so custom/contrib engines appear). Same probe as Settings →
 * Accounts. Order: built-ins in cycle order, then user presets, then
 * installed contrib engines.
 */
export async function probeEngines(): Promise<EngineProbeResult> {
  const statuses = await detectEngineStatuses(await probeableEngineIds())
  const lines = ["engines:"]
  for (const status of statuses) {
    const account = describeAccount(status.account)
    // padEnd(7)+space: an 8-char custom id must not butt against the ✓/✗.
    const name = `${status.vendor.padEnd(7)} `
    lines.push(`  ${name}${binaryLabel(status.binary)}${status.binary.found ? ` — ${account}` : ""}`)
    if (status.accountError) lines.push(`          ⚠ ${status.accountError}`)
  }
  // "Usable" = binary present AND some account. One usable engine is enough;
  // a missing vendor the user never launches is not a finding.
  const { usable, signedOut } = summarizeEngines(statuses)
  return { lines, anyUsable: usable.length > 0, signedOut }
}
