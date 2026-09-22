/**
 * Daemon-boot cleanup of what a `kill -9` mid-save leaves in the index dir:
 *   - `tasks.json.lock`: left in 20/20 measured crash trials; otherwise only
 *     the next acquirer's takeover (`lockfile.ts`) clears it.
 *   - `tasks.json.<pid>.<ulid>.tmp`: its unlink is in a `catch` SIGKILL never
 *     runs. 1/20 trials left one (11.8 MB for a 30k-task manifest); names never
 *     repeat, so the leak is unbounded.
 * Not in the save path: a directory scan doesn't belong inside the
 * cross-process critical section.
 */

import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { isProcessAlive, releaseSync } from "./lockfile.ts"

/** Younger files may be another process's in-flight save; a real save
 *  renames in well under a second. */
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
 * Best-effort: each removal is guarded; an unreadable dir reports nothing
 * rather than throwing into daemon boot. The lock goes only when its pid is
 * dead AND the file still holds what we read (same verified takeover as
 * `acquire`), so a lock a live Rove just took survives.
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
  // `releaseSync` no-ops if the lock changed hands; ask the filesystem.
  return !existsSync(lockPath)
}
