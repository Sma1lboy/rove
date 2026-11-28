/**
 * "Which version of this engine's CLI is installed?" — asked only of engines
 * whose registry entry declares `versionArgs`, and only when the binary found
 * is the engine's own CLI rather than a user wrapper that may not understand
 * the flag. Never throws: an unknown version is `null`, never a guess.
 */

import { spawn } from "node:child_process"
import path from "node:path"
import type { VendorId } from "@sma1lboy/rove-core/types/vendor.ts"
import type { BinaryStatus } from "./account-detect"
import type { EngineStatus } from "./engine-status"
import { engineEntry } from "./registry"

const VERSION_PROBE_MS = 3000
const MAX_OUTPUT = 4096

/** Runs `bin args…` and resolves its stdout, or `null` when it fails or times out. */
export type VersionRunner = (bin: string, args: readonly string[]) => Promise<string | null>

/** The first dotted version number in a CLI's `--version` output (`2.1.3`, `0.47.0-alpha.2`). */
export function parseVersionOutput(output: string): string | null {
  return /\b\d+(?:\.\d+)+(?:-[0-9A-Za-z.]+)?\b/.exec(output)?.[0] ?? null
}

const runVersionCommand: VersionRunner = (bin, args) =>
  new Promise((resolve) => {
    let out = ""
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, [...args], { stdio: ["ignore", "pipe", "ignore"] })
    } catch {
      return resolve(null)
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), VERSION_PROBE_MS)
    child.stdout?.on("data", (b: Buffer) => {
      if (out.length < MAX_OUTPUT) out += b.toString()
    })
    child.on("error", () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? out : null)
    })
  })

/** The installed CLI version of `vendor`, or `null` when the engine declares no way to ask or the answer is unreadable. */
export async function readEngineVersion(
  vendor: VendorId,
  binary: BinaryStatus,
  run: VersionRunner = runVersionCommand,
): Promise<string | null> {
  if (!binary.found) return null
  const entry = engineEntry(vendor)
  const own = entry.defaultCommand[0]
  if (!entry.versionArgs || !own) return null
  // A wrapper script named in a launch override may start a session instead of printing a version.
  if (path.basename(binary.path) !== path.basename(own)) return null
  const output = await run(binary.path, entry.versionArgs).catch(() => null)
  return output === null ? null : parseVersionOutput(output)
}

/** `statuses` with `version` filled in where it could be read. */
export function withEngineVersions(
  statuses: readonly EngineStatus[],
  run: VersionRunner = runVersionCommand,
): Promise<EngineStatus[]> {
  return Promise.all(
    statuses.map(async (status) => {
      const version = await readEngineVersion(status.vendor, status.binary, run)
      return version ? { ...status, version } : status
    }),
  )
}
