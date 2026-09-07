/**
 * Startup hygiene for the task index directory.
 *
 * Two things a `kill -9` leaves behind, both invisible to every later run:
 *
 *   - **The lockfile.** 20 of 20 measured crash trials during a save left
 *     `tasks.json.lock` on disk. Nothing clears it at boot; it is removed
 *     only opportunistically, by whichever acquirer next trips over it —
 *     so the first save of the day is the thing that discovers it, through
 *     the takeover path in `lockfile.ts`.
 *   - **The staging file.** `doSave` stages to `tasks.json.<pid>.<ulid>.tmp`
 *     (unique per save on purpose, so a second writer cannot clobber the
 *     first's), and its unlink lives in a `catch` that a SIGKILL never runs.
 *     1 of 20 trials left one: a full 11.8 MB copy of a 30k-task manifest,
 *     under a name no later run will ever reuse or notice. The leak is
 *     unbounded because the names never repeat.
 *
 * Deliberately NOT in the save path: this is a directory scan, and `doSave`
 * runs inside the cross-process critical section. It belongs at daemon boot,
 * which is also the moment a crashed predecessor's mess is newest.
 */

import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { isProcessAlive, releaseSync } from "./lockfile.ts"

/** Staging files younger than this may belong to a save running RIGHT NOW in
 *  another process — a real save writes and renames in well under a second,
 *  so anything this old is a corpse. */
const TMP_MAX_AGE_MS = 5 * 60_000

export interface IndexSweepResult {
  /** Orphaned staging files removed (absolute paths). */
  readonly tmp: readonly string[]
  /** Bytes reclaimed from those staging files. */
  readonly tmpBytes: number
  /** Whether a stale `tasks.json.lock` was cleared. */
  readonly lock: boolean
}

/**
 * Remove a crashed writer's leftovers from `stateDir`. Best-effort by
 * contract: every removal is independently guarded, and an unreadable
 * directory reports nothing swept rather than throwing into daemon boot.
 *
 * The lockfile is removed only when its recorded pid is gone AND the file
 * still holds exactly what we judged — the same verified takeover `acquire`
 * performs, so a lock a live Rove took between our read and our unlink
 * survives.
 */
export function sweepIndexLeftovers(stateDir: string, now = Date.now()): IndexSweepResult {
  const tmp: string[] = []
  let tmpBytes = 0
  let entries: string[]
  try {
    entries = readdirSync(stateDir)
  } catch {
    return { tmp, tmpBytes, lock: false }
  }

  for (const name of entries) {
    if (!name.startsWith("tasks.json.") || !name.endsWith(".tmp")) continue
    const path = join(stateDir, name)
    try {
      const stat = statSync(path)
      if (now - stat.mtimeMs < TMP_MAX_AGE_MS) continue
      unlinkSync(path)
      tmp.push(path)
      tmpBytes += stat.size
    } catch {
      /* vanished, or not ours to remove — either way nothing to report */
    }
  }

  return { tmp, tmpBytes, lock: clearStaleLock(join(stateDir, "tasks.json.lock")) }
}

/** True when a lockfile naming a dead process was cleared. */
function clearStaleLock(lockPath: string): boolean {
  let holder: string
  try {
    holder = readFileSync(lockPath, "utf8").trim()
  } catch {
    return false
  }
  const pid = Number.parseInt(holder, 10)
  if (Number.isFinite(pid) && pid > 0 && isProcessAlive(pid)) return false
  releaseSync(lockPath, holder)
  // `releaseSync` is a no-op when the lock changed hands under us, so ask the
  // filesystem rather than reporting the removal we merely attempted.
  return !existsSync(lockPath)
}
