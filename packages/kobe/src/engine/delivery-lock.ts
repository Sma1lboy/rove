/**
 * One prompt delivery at a time per hosted session.
 *
 * `writeHostedPrompt` is a sequence against one pty (bracketed paste, settle,
 * submit key), run by each `rove api send` from its own process. The PTY
 * host's `write` is a bare `proc.write` with no per-key queue, so two sends to
 * one tab interleave as
 *
 *   A: ESC[200~ …A… ESC[201~   B: ESC[200~ …B… ESC[201~   A: CR   B: CR
 *
 * and the engine submits one composer holding A+B; B's CR hits an empty
 * composer. Measured on claude 2.1.273 over a real pty: deliveries 50ms apart
 * make one turn with both messages, 400ms apart make two.
 *
 * Not in the host: the gap is between two of its RPCs, so it would need a new
 * protocol verb, and a running host keeps its boot-time build until
 * `rove reset`. A lockfile works with every host.
 *
 * Best effort, never a refusal: past {@link DELIVERY_LOCK_TIMEOUT_MS} the
 * delivery writes anyway. A merged prompt is a nuisance; a dropped report is
 * a lie.
 */

import path from "node:path"
import { defaultDeliveryLockDir } from "@sma1lboy/kobe-daemon/daemon/paths"
import { LockfileError, acquire, release } from "../orchestrator/index/lockfile.ts"

/** Wait before writing unserialised. Well above one delivery's critical section
 *  (`SUBMIT_DELAY_MS` + two RPCs) so back-to-back sends queue; short enough
 *  that a stale holder can't stall a report for long. */
const DELIVERY_LOCK_TIMEOUT_MS = 5_000
/** Retry interval while another sender holds the key. */
const DELIVERY_LOCK_RETRY_MS = 20

/** Keys are `<taskId>::<tabId>`; `::` and path separators must go, or
 *  `a::tab-1` would land inside a directory `a`. */
function lockFileName(key: string): string {
  return `${key.replace(/[^A-Za-z0-9._-]/g, "_")}.lock`
}

/** Where `key`'s delivery lock lives. */
export function deliveryLockPath(key: string, lockDir = defaultDeliveryLockDir()): string {
  return path.join(lockDir, lockFileName(key))
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run `fn` holding `key`'s delivery lock, released however `fn` ends. A lock
 * that never came free is deliberately invisible to the caller: reporting it
 * would invite a caller to refuse.
 */
export async function withDeliveryLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts: { readonly lockDir?: string; readonly timeoutMs?: number } = {},
): Promise<T> {
  const lockPath = deliveryLockPath(key, opts.lockDir ?? defaultDeliveryLockDir())
  const deadline = Date.now() + (opts.timeoutMs ?? DELIVERY_LOCK_TIMEOUT_MS)
  let token: string | null = null
  for (;;) {
    try {
      token = await acquire(lockPath)
      break
    } catch (err) {
      // LockfileError = live holder, wait. Anything else is the filesystem
      // refusing us (read-only home): deliver unlocked rather than fail.
      if (!(err instanceof LockfileError)) break
      if (Date.now() >= deadline) break
      await sleep(DELIVERY_LOCK_RETRY_MS)
    }
  }
  try {
    return await fn()
  } finally {
    if (token !== null) await release(lockPath, token).catch(() => {})
  }
}
