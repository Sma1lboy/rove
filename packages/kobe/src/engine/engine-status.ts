/**
 * "Can Rove launch this engine here, and is it logged in?" — for ANY engine
 * id, not just the four with a dedicated account detector.
 *
 * `account-detect.ts` answers both questions for the built-ins (claude /
 * codex / copilot / kimi), each against its own credential file. Everything
 * else Rove can launch — the shipped contrib catalog, plugin-registered
 * engines, engines the user added — has no account detector by design (that
 * per-vendor work is what promotes an engine to built-in). The *binary*
 * question is still answerable for all of them: probe `argv[0]` of the launch
 * command the task would actually run, override included. So Settings →
 * Accounts can cover every engine in the list, with `account: null` meaning
 * "no detector for this engine" — never "not logged in".
 *
 * A built-in whose dedicated finder misses falls back to the same launch-command
 * probe, so pointing `engineCommand.claude` at an off-PATH binary stops reading
 * as "not found".
 */

import { spawnSync } from "node:child_process"
import { statSync } from "node:fs"
import path from "node:path"
import type { VendorId } from "@/types/vendor"
import {
  type BinaryStatus,
  type ClaudeAccount,
  type CodexAccount,
  type CopilotAccount,
  type DetectDeps,
  type EngineAccountStatus,
  type KimiAccount,
  detectClaudeAccount,
  detectCodexAccount,
  detectCopilotAccount,
  detectKimiAccount,
} from "./account-detect"
import { interactiveEngineCommand } from "./interactive-command"

/** Any built-in engine's account shape (the union the Accounts view renders). */
export type EngineAccount = ClaudeAccount | CodexAccount | CopilotAccount | KimiAccount

export interface EngineStatus {
  readonly vendor: VendorId
  readonly binary: BinaryStatus
  /** `null` = no account detector for this engine (contrib / plugin / custom). */
  readonly account: EngineAccount | null
  readonly accountError?: string
}

const BUILTIN_DETECTORS: Record<string, (deps?: DetectDeps) => Promise<EngineAccountStatus<EngineAccount>>> = {
  claude: detectClaudeAccount,
  codex: detectCodexAccount,
  copilot: detectCopilotAccount,
  kimi: detectKimiAccount,
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
  const detector = BUILTIN_DETECTORS[vendor]
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
