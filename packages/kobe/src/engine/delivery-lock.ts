/**
 * One prompt delivery at a time per hosted session.
 *
 * `writeHostedPrompt` is a SEQUENCE against one pty — bracketed paste, a
 * settle, then the submit key — and every `rove api send` runs it from its own
 * short-lived process. Nothing downstream serialises those processes: the PTY
 * host's `write` is a bare `proc.write` per call, with no per-key queue, so two
 * sends aimed at the same tab interleave as
 *
 *   A: ESC[200~ …A… ESC[201~   B: ESC[200~ …B… ESC[201~   A: CR   B: CR
 *
 * The engine then holds ONE composer containing A+B, submits it on A's CR, and
 * B's CR lands on an empty composer. Measured against claude 2.1.273 driving a
 * real pty: two deliveries 50ms apart produce a single turn carrying both
 * messages, 400ms apart produce two — the same "one user turn, two `[ROVE PEER]`
 * headers" shape that made peer replies look like they were piling up unsent in
 * the input area.
 *
 * Why here and not in the host: the host would be the tidier owner, but the gap
 * is BETWEEN two of its RPCs, so closing it there means a new protocol verb — and
 * a host keeps its boot-time build until `rove reset`, so a new client would
 * still have to carry this path for every host already running. A lockfile is
 * the one primitive both senders can agree on today.
 *
 * Best effort, never a refusal. A delivery that cannot take the lock inside
 * {@link DELIVERY_LOCK_TIMEOUT_MS} writes anyway: the cost of waiting out a
 * wedged holder is a worker's report never reaching its coordinator, and "the
 * only refusals left on delivery are physical" (#959). A merge is a nuisance; a
 * dropped report is a lie.
 */

import path from "node:path"
import { defaultDeliveryLockDir } from "@sma1lboy/kobe-daemon/daemon/paths"
import { LockfileError, acquire, release } from "../orchestrator/index/lockfile.ts"

/** How long a delivery waits for the session's lock before going ahead
 *  unserialised. Comfortably above one delivery's own critical section
 *  (`SUBMIT_DELAY_MS` plus two RPC round-trips) so ordinary back-to-back sends
 *  queue rather than collide, and short enough that a stale holder cannot stall
 *  a report for long. */
const DELIVERY_LOCK_TIMEOUT_MS = 5_000
/** Retry interval while another sender holds the key. */
const DELIVERY_LOCK_RETRY_MS = 20

/** A session key is `<taskId>::<tabId>` — `::` and any path separator have to
 *  go, or the lock for `a::tab-1` would try to live inside a directory `a`. */
function lockFileName(key: string): string {
  return `${key.replace(/[^A-Za-z0-9._-]/g, "_")}.lock`
}

/** Where `key`'s delivery lock lives. Exported for tests and for anyone
 *  debugging a contended send. */
export function deliveryLockPath(key: string, lockDir = defaultDeliveryLockDir()): string {
  return path.join(lockDir, lockFileName(key))
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run `fn` holding `key`'s delivery lock, releasing it however `fn` ends.
 *
 * Returns what `fn` returned; a lock that never came free is not an error, so
 * the caller cannot tell a serialised delivery from an unserialised one — which
 * is deliberate. Nothing above this decides anything differently on that basis,
 * and reporting it would invite a caller to refuse.
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
      // A LockfileError is a live holder: wait it out. Anything else is the
      // filesystem refusing us (read-only home, missing dir we cannot make) —
      // deliver unlocked rather than fail a send over a lock.
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
