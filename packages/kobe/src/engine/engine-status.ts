/**
 * "Can Rove launch this engine here, and is it logged in?" — for ANY engine
 * id, not just the four with a dedicated account detector.
 *
 * WHICH detector runs is the registry entry's `detectAccount`, not a table
 * here — a second list would silently read a missing engine as "login not
 * detectable".
 *
 * Built-ins (claude / codex / copilot / kimi) have account detectors in
 * `account-detect.ts`. Contrib, plugin and user engines have none by design;
 * for them only the binary is probed (`argv[0]` of the real launch command,
 * override included). `account: null` means "no detector" — never "not logged in".
 *
 * A built-in whose dedicated finder misses falls back to the launch-command
 * probe, so an off-PATH `engineCommand.claude` isn't reported "not found".
 */

import { spawnSync } from "node:child_process"
import { statSync } from "node:fs"
import path from "node:path"
import type { VendorId } from "@/types/vendor"
import type {
  BinaryStatus,
  ClaudeAccount,
  CodexAccount,
  CopilotAccount,
  DetectDeps,
  KimiAccount,
} from "./account-detect"
import { installedEngineIds } from "./account-detect"
import { listPresetIds } from "./engine-presets"
import { interactiveEngineCommand } from "./interactive-command"
import { engineEntry } from "./registry"

/** Any built-in engine's account shape (the union the Accounts view renders). */
export type EngineAccount = ClaudeAccount | CodexAccount | CopilotAccount | KimiAccount

export interface EngineStatus {
  readonly vendor: VendorId
  readonly binary: BinaryStatus
  /** `null` = no account detector for this engine (contrib / plugin / custom). */
  readonly account: EngineAccount | null
  readonly accountError?: string
}

export interface EngineStatusDeps {
  /** Resolve a bare command name on PATH; `null` when absent. */
  which(bin: string): string | null
  /** The argv a task would launch for this engine (override-aware). */
  command(vendor: VendorId): readonly string[]
  /** Forwarded to the built-in account detectors. */
  accountDeps?: DetectDeps
}

function whichOnPath(bin: string): string | null {
  // Bun.which is a syscall; under vitest (node runtime) shell out instead.
  const bunWhich = globalThis.Bun?.which
  if (bunWhich) return bunWhich(bin)
  const out = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" })
  if (out.status !== 0) return null
  return (
    out.stdout
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? null
  )
}

const defaultDeps: EngineStatusDeps = {
  which: whichOnPath,
  command: (vendor) => interactiveEngineCommand(vendor),
}

/**
 * Probe the binary an engine's launch command names: an explicit path is
 * stat'd, a bare name goes through `which`. Never throws — a miss is a
 * `{ found: false }` the Accounts view renders as a warning line.
 */
export function probeLaunchBinary(argv: readonly string[], which: (bin: string) => string | null): BinaryStatus {
  const bin = argv[0]?.trim()
  if (!bin) return { found: false, error: "no launch command" }
  if (bin.includes(path.sep) || bin.startsWith(".")) {
    try {
      if (statSync(bin).isFile()) return { found: true, path: bin }
    } catch {
      // fall through to the same "not found" the which-miss reports
    }
    return { found: false, error: `not found at ${bin}` }
  }
  const found = which(bin)
  return found ? { found: true, path: found } : { found: false, error: "not found on PATH" }
}

export async function detectEngineStatus(
  vendor: VendorId,
  over: Partial<EngineStatusDeps> = {},
): Promise<EngineStatus> {
  const deps = { ...defaultDeps, ...over }
  const detector = engineEntry(vendor).detectAccount
  if (!detector) {
    return { vendor, binary: probeLaunchBinary(deps.command(vendor), deps.which), account: null }
  }
  const status = await detector(deps.accountDeps)
  // The dedicated finder knows install dirs `which` doesn't; when it still
  // misses, the user's launch override is the honest second opinion.
  const binary = status.binary.found ? status.binary : probeLaunchBinary(deps.command(vendor), deps.which)
  return { vendor, binary, account: status.account, accountError: status.accountError }
}

export function detectEngineStatuses(
  vendors: readonly VendorId[],
  over: Partial<EngineStatusDeps> = {},
): Promise<EngineStatus[]> {
  return Promise.all(vendors.map((v) => detectEngineStatus(v, over)))
}

/**
 * One-line description of any built-in engine's account, for plain-text
 * surfaces (`rove doctor`). Switches on the account KIND (`oauth` / `chatgpt` /
 * `apikey` / `token` / `none`), never on a vendor. Settings renders the same
 * union themed + i18n.
 *
 * `null` = no account detector (contrib / plugin / custom), which is NOT "not
 * logged in" — say so.
 */
export function describeAccount(account: EngineAccount | null): string {
  if (account === null) return "login not detectable"
  switch (account.kind) {
    case "oauth":
      // Claude's oauth carries an identity; copilot's and kimi's don't.
      return "email" in account
        ? `logged in (${account.email}${account.organization ? `, ${account.organization}` : ""})`
        : "logged in"
    case "chatgpt":
      return `logged in (${account.email}${account.plan ? `, ${account.plan}` : ""})`
    case "apikey":
      return "API key"
    case "token":
      return `token (${account.source})`
    default:
      return "no account"
  }
}

/** True when this engine could actually run a task: its binary is present
 *  and, for engines whose login Rove CAN read, an account exists. A null
 *  account (no detector) does not veto — the binary is all we can know. */
function engineUsable(status: EngineStatus): boolean {
  return status.binary.found && status.account?.kind !== "none"
}

/**
 * Every engine id worth probing on this machine: the registered presets
 * (built-ins + the user's own) plus the contrib engines whose binary is
 * actually on PATH.
 *
 * `listPresetIds()` alone omits contrib engines, so `rove doctor` and the setup
 * wizard would call an opencode-only machine "no usable engine". Uninstalled
 * contrib engines stay out — `✗ not found` rows for them are noise.
 */
export async function probeableEngineIds(): Promise<readonly VendorId[]> {
  return [...new Set<VendorId>([...listPresetIds(), ...(await installedEngineIds())])]
}

/** Engine readiness split three ways, from one pass of statuses. */
export interface EngineReadiness {
  /** Could run a task right now (binary present, and logged in where readable). */
  readonly usable: readonly VendorId[]
  /** Binary on PATH, but the login Rove CAN read says there is no account
   *  (the common new-user state). */
  readonly signedOut: readonly VendorId[]
}

/**
 * Split statuses into "can run a task" and "installed but not signed in".
 * `usable.length === 0` alone can't tell "no CLI" (install) from "one login
 * away" (run it once and log in).
 */
export function summarizeEngines(statuses: readonly EngineStatus[]): EngineReadiness {
  const usable: VendorId[] = []
  const signedOut: VendorId[] = []
  for (const status of statuses) {
    if (engineUsable(status)) usable.push(status.vendor)
    else if (status.binary.found) signedOut.push(status.vendor)
  }
  return { usable, signedOut }
}
