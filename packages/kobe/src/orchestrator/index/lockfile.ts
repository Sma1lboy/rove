/**
 * PID-based lockfile for the task index.
 *
 * Goal: prevent two Rove instances from racing to write `~/.rove/tasks.json`
 * and corrupting it. The lockfile holds `pid:token` — the holder's PID plus a
 * per-acquire random token, so two stores in the SAME process are still
 * distinguishable holders (issue #53).
 *
 * Creation is atomic-or-fail: contents are written to a private sidecar file
 * first, then `link(2)`ed into place. The lockfile is therefore never
 * observable in a half-written (empty) state — an empty read used to classify
 * a live holder as stale and break mutual exclusion outright.
 *
 * Failure modes:
 *
 *   - **Holder is alive** — `acquire()` rejects. The other instance gets a
 *     clear "another kobe is running" error. (Higher layers can decide
 *     whether to retry or surface to the user.)
 *
 *   - **Holder crashed** (process gone, lockfile remains stale) — we
 *     test the recorded PID with `process.kill(pid, 0)` (signal 0 is
 *     "test only"). If it throws ESRCH, the holder is dead; we log a
 *     warning, remove the stale lockfile, and re-acquire.
 *
 *   - **Holder is a different program reusing the PID** — false positive,
 *     we'd wait forever. Acceptable: PID reuse on the same machine in
 *     the same minute is rare, and the cost of a false negative (corrupted
 *     index) is much worse than the cost of a false positive (kobe refuses
 *     to start, user kills the lockfile manually).
 *
 * Not goals: cross-machine locking (NFS-safe), advisory POSIX locks
 * (flock — Bun coverage uneven), retry/backoff (caller's choice).
 */

import { randomBytes } from "node:crypto"
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export interface LockfileOptions {
  /**
   * If the holder PID is alive, should we steal anyway? Default false.
   * Used by tests that want to bypass the live-process check.
   */
  readonly forceTakeover?: boolean
}

/**
 * Check whether a process exists. `process.kill(pid, 0)` is the standard
 * trick: signal 0 doesn't actually send a signal, it just performs the
 * permission/existence check.
 *
 * - alive → returns
 * - dead (ESRCH) → throws Error{code: "ESRCH"}
 * - permission denied (EPERM) → throws; we treat this as "alive" because
 *   the process exists, we just can't signal it.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ESRCH") return false
    // EPERM means the process exists but we can't signal it — count as alive.
    return true
  }
}

export class LockfileError extends Error {
  readonly heldByPid: number
  constructor(message: string, heldByPid: number) {
    super(message)
    this.name = "LockfileError"
    this.heldByPid = heldByPid
  }
}

/**
 * Acquire an exclusive lock at `lockPath` and return the ownership token to
 * pass to {@link release}. The lock's contents are `pid:token` — `parseInt`
 * still extracts the PID, so older builds reading a new lock see the holder
 * correctly, and a legacy bare-PID lock parses here the same way.
 *
 * Throws {@link LockfileError} if the lock is held by a live process
 * (including a sibling store in this same process — it will release; wait).
 */
export async function acquire(lockPath: string, opts: LockfileOptions = {}): Promise<string> {
  await mkdir(dirname(lockPath), { recursive: true })
  const token = `${process.pid}:${randomBytes(8).toString("hex")}`
  const sidecar = `${lockPath}.${token.replace(":", "-")}`

  for (;;) {
    // Atomic creation: full contents first, then link into place. `link`
    // either succeeds or fails EEXIST — no observable empty-lockfile window.
    await writeFile(sidecar, token)
    try {
      await link(sidecar, lockPath)
      return token
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
    } finally {
      await unlink(sidecar).catch(() => {})
    }

    // Lock exists. Inspect the holder.
    let holder: string
    try {
      holder = (await readFile(lockPath, "utf8")).trim()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
      // Holder released between our EEXIST and the read — try again.
      continue
    }

    const holderPid = Number.parseInt(holder, 10)
    const alive = Number.isFinite(holderPid) && holderPid > 0 && isProcessAlive(holderPid)
    if (alive && !opts.forceTakeover) {
      throw new LockfileError(`task index is locked by another Rove instance (pid ${holderPid})`, holderPid)
    }

    // Stale (or stolen): remove and loop back to the atomic create. If a
    // rival waiter wins the takeover race, the next iteration observes their
    // live lock and rejects. We log to stderr so the user sees the takeover
    // happen — silent takeovers are scary in concurrent contexts.
    console.warn(
      `[rove] removing stale lockfile at ${lockPath} (was held by pid ${holderPid}` +
        `${alive ? ", forced" : ", process gone"})`,
    )
    try {
      await unlink(lockPath)
    } catch (err) {
      // Race: another acquirer also unlinked. ENOENT is fine here.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    }
  }
}

/**
 * Release the lock acquired with `token`. Only removes the file while we
 * still own it: after a (forced) takeover the lockfile belongs to the new
 * holder, and unlinking it would let a third writer into the critical
 * section behind their back. Tolerant of "already gone".
 */
export async function release(lockPath: string, token: string): Promise<void> {
  let current: string
  try {
    current = (await readFile(lockPath, "utf8")).trim()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return
    throw err
  }
  if (current !== token) return
  try {
    await unlink(lockPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return
    throw err
  }
}
