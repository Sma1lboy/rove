/**
 * Fire-and-forget detached spawn helper.
 *
 * Several neutral layers need to hand a file/URL off to the OS and exit
 * without waiting for the child. This centralizes the repeated
 * `{ detached: true, stdio: "ignore" } + .unref()` incantation and gives
 * callers a single hook for spawn failures.
 */

import { spawn } from "node:child_process"

export interface SpawnDetachedOpts {
  /** Called for both synchronous spawn exceptions and async `error` events. */
  onError?: (err: Error) => void
}

/** Spawn `cmd` detached and unref'd. Returns whether spawn succeeded. */
export function spawnDetached(cmd: string, args: readonly string[], opts: SpawnDetachedOpts = {}): boolean {
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" })
    child.on("error", (err) => opts.onError?.(err))
    child.unref()
    return true
  } catch (err) {
    if (opts.onError && err instanceof Error) opts.onError(err)
    return false
  }
}
