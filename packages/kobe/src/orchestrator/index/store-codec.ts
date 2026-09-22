/**
 * Stateless I/O half of {@link TaskIndexStore}: lock retry
 * ({@link acquireWithRetry}), manifest-scope codec ({@link normalizeIndex};
 * per-row coercion is `store-codec-rows.ts`), the load-time recovery ladder
 * ({@link recoverIndexFromDisk}), and the disk side of read-merge-write
 * ({@link readDiskIndex} + {@link mergeTasksWithDisk}). The store keeps the
 * mutable half: cache, dirty tracking, when to persist.
 */

import { existsSync } from "node:fs"
import { copyFile, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { logClient } from "@sma1lboy/kobe-daemon/client/client-log"
import { defaultClientLogPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import { DAEMON_MIGRATION_MARKER } from "../../state/layout-migration.ts"
import type { Task, TaskTombstone } from "../../types/task.ts"
import { LockfileError, acquire } from "./lockfile.ts"
import { coerceTask } from "./store-codec-rows.ts"

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll interval while another kobe instance briefly holds the index lock. */
const LOCK_RETRY_DELAY_MS = 25
/** Holds are millisecond-scale (one read-merge-write); past 5s surface the
 *  {@link LockfileError} rather than block a UI thread. */
const LOCK_MAX_WAIT_MS = 5_000

/**
 * {@link acquire} rejects at once on a live holder (it steals stale ones
 * itself), so the fixed-backoff wait lives here. Non-contention errors and a
 * blown deadline propagate. Returns the token for `release`.
 */
export async function acquireWithRetry(lockPath: string): Promise<string> {
  const deadline = Date.now() + LOCK_MAX_WAIT_MS
  for (;;) {
    try {
      return await acquire(lockPath)
    } catch (err) {
      if (!(err instanceof LockfileError) || Date.now() >= deadline) throw err
      await sleep(LOCK_RETRY_DELAY_MS)
    }
  }
}

const CURRENT_VERSION = 3 as const

/**
 * Copy a corrupt manifest's bytes aside before recovering empty: the next
 * save read-merge-writes from the empty base and REPLACES the file, destroying
 * whatever tasks it held. Best-effort (never blocks startup/save); null when
 * the copy failed.
 */
async function backupCorruptManifest(path: string, now: () => Date = () => new Date()): Promise<string | null> {
  const backupPath = `${path}.corrupt-${now().toISOString().replaceAll(":", "-")}`
  try {
    await copyFile(path, backupPath)
    return backupPath
  } catch {
    return null
  }
}

/** Manifest versions this build can read. A manifest stamped with anything
 *  else is a FUTURE build's — see {@link recoverUnsupportedVersion}. */
const SUPPORTED_VERSIONS: ReadonlySet<unknown> = new Set([1, 2, 3])

/** Both sinks: the opentui alternate screen paints over stdout/stderr, so
 *  `console.warn` alone leaves no findable trace of an emptied index. */
function warnManifestRecovery(message: string, manifestPath?: string): void {
  console.warn(message)
  // Log into the manifest's home, not the ambient default, so an explicit
  // homeDir store logs into ITS home.
  logClient("tasks-index", message, manifestPath ? defaultClientLogPath(dirname(dirname(manifestPath))) : undefined)
}

/**
 * An unknown version is a FUTURE build's file (user downgraded). Recover empty,
 * but copy the bytes aside first like the corrupt-JSON path: the next save
 * replaces the file. True when handled (caller recovers empty).
 */
async function recoverUnsupportedVersion(parsed: unknown, sourcePath: string): Promise<boolean> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false
  const version = (parsed as { version?: unknown }).version
  if (version === undefined || SUPPORTED_VERSIONS.has(version)) return false
  const backup = await backupCorruptManifest(sourcePath)
  warnManifestRecovery(
    `[rove] tasks.json at ${sourcePath} has unsupported version=${String(version)}; recovering with empty index.${
      backup ? ` Original bytes backed up to ${backup}.` : " Backup copy failed; the stale file is left in place."
    }`,
    sourcePath,
  )
  return true
}

/**
 * Arbitrary JSON → v3 cache. v1/v2 migrate by dropping `tabs`, `activeTabId`,
 * `sessionId`, `permissionMode`; the first save persists v3. The version guard
 * is a last-resort net: async read paths run {@link recoverUnsupportedVersion}
 * first so the bytes are backed up.
 */
export function normalizeIndex(parsed: unknown, source: string): { version: typeof CURRENT_VERSION; tasks: Task[] } {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    warnManifestRecovery(`[rove] tasks.json at ${source} is not an object; recovering with empty index.`, source)
    return { version: CURRENT_VERSION, tasks: [] }
  }

  const obj = parsed as { version?: unknown; tasks?: unknown }
  const version = obj.version
  if (version !== undefined && !SUPPORTED_VERSIONS.has(version)) {
    warnManifestRecovery(
      `[rove] tasks.json at ${source} has unsupported version=${String(version)}; recovering with empty index.`,
      source,
    )
    return { version: CURRENT_VERSION, tasks: [] }
  }

  const rawTasks = Array.isArray(obj.tasks) ? obj.tasks : []
  const tasks: Task[] = []
  for (const entry of rawTasks) {
    const task = coerceTask(entry)
    if (task) tasks.push(task)
    else {
      console.warn(`[rove] dropping malformed task entry from ${source}: ${JSON.stringify(entry)}`)
    }
  }
  return { version: CURRENT_VERSION, tasks }
}

/** A tombstone only has to outlive any live writer's dirty reference (flushed
 *  on its next save); 30 days is generous and keeps growth negligible. */
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Legacy `~/.kobe/tasks.json` as a read fallback for daemon-free readers
 * (`export`, orchestrator bridge) on an unmigrated home; `undefined` once the
 * daemon migration marker exists. After that it's a frozen snapshot and
 * reading it resurrects deleted tasks — the whole index after Reset UI state
 * (which unlinks only the canonical file), and any deletion on the next save
 * (merge folds unknown ids back in as concurrent creates).
 */
export function readableLegacyIndexPath(canonicalPath: string, legacyPath: string): string | undefined {
  return existsSync(join(dirname(canonicalPath), DAEMON_MIGRATION_MARKER)) ? undefined : legacyPath
}

/**
 * Fresh disk read (tasks + tombstones) so a save reflects peer writes. Mirrors
 * {@link TaskIndexStore.load}: missing canonical → legacy; both absent or
 * corrupt → empty. Never touches the store cache or listeners.
 */
export async function readDiskIndex(
  path: string,
  legacyPath: string,
): Promise<{ tasks: Task[]; removed: TaskTombstone[] }> {
  let raw: string
  let sourcePath = path
  try {
    raw = await readFile(sourcePath, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    const legacy = readableLegacyIndexPath(path, legacyPath)
    if (!legacy) return { tasks: [], removed: [] }
    sourcePath = legacy
    try {
      raw = await readFile(sourcePath, "utf8")
    } catch (legacyErr) {
      if ((legacyErr as NodeJS.ErrnoException).code === "ENOENT") return { tasks: [], removed: [] }
      throw legacyErr
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Preserve bytes before the merged write replaces a corrupt source.
    await backupCorruptManifest(sourcePath)
    return { tasks: [], removed: [] }
  }
  // Likewise for a manifest this build can't read.
  if (await recoverUnsupportedVersion(parsed, sourcePath)) return { tasks: [], removed: [] }
  return { tasks: normalizeIndex(parsed, sourcePath).tasks, removed: coerceTombstones(parsed) }
}

/** Coerce the manifest's optional `removed` field; malformed entries drop. */
function coerceTombstones(parsed: unknown): TaskTombstone[] {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return []
  const raw = (parsed as { removed?: unknown }).removed
  if (!Array.isArray(raw)) return []
  const out: TaskTombstone[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const v = entry as Record<string, unknown>
    if (typeof v.id === "string" && v.id.length > 0 && typeof v.at === "string") out.push({ id: v.id, at: v.at })
  }
  return out
}

/**
 * Merge fresh disk state with in-memory intent. Invariants (as `state/store.ts`):
 *   - Ids we touched (`dirty`) win — last-write-wins per task.
 *   - A deletion beats a concurrent edit from either side: our `removed` and
 *     peer tombstones both suppress the task even if dirty (ULIDs are never
 *     reused, so a tombstone can't shadow a new task).
 *   - A task gone from disk and untouched by us is not resurrected.
 *   - Peer creates/updates we didn't touch are kept.
 * Returns merged tasks + tombstones to persist (disk ∪ ours, expired pruned).
 */
export function mergeTasksWithDisk(
  cacheTasks: readonly Task[],
  diskTasks: Task[],
  dirty: ReadonlySet<string>,
  removed: ReadonlyMap<string, string>,
  diskRemoved: readonly TaskTombstone[] = [],
  now: number = Date.now(),
): { tasks: Task[]; removed: TaskTombstone[] } {
  const tombstones = new Map<string, string>()
  for (const t of diskRemoved) {
    const at = Date.parse(t.at)
    if (!Number.isFinite(at) || now - at > TOMBSTONE_TTL_MS) continue // expired (or malformed): prune
    tombstones.set(t.id, t.at)
  }
  for (const [id, at] of removed) tombstones.set(id, at)

  const diskById = new Map(diskTasks.map((t) => [t.id, t] as const))
  const result: Task[] = []
  const included = new Set<string>()

  // 1. Our cache order is the persisted order.
  for (const task of cacheTasks) {
    if (tombstones.has(task.id)) continue // deleted (here or by a peer): deletion beats our edit
    if (dirty.has(task.id)) {
      result.push(task) // we changed it: our version wins
    } else {
      const onDisk = diskById.get(task.id)
      if (onDisk === undefined) continue // untouched here AND gone from disk: a peer removed it
      result.push(onDisk) // untouched here: take the peer's possibly-newer copy
    }
    included.add(task.id)
  }

  // 2. Concurrent creates, appended after our ordering.
  for (const task of diskTasks) {
    if (included.has(task.id) || tombstones.has(task.id)) continue
    result.push(task)
    included.add(task.id)
  }

  return { tasks: result, removed: [...tombstones].map(([id, at]) => ({ id, at })) }
}

/**
 * Disk → v3 index. Recovery ladder: missing file → gated legacy twin →
 * corrupt JSON → future-build version; every failure yields an EMPTY index
 * after copying the original bytes aside.
 */
export async function recoverIndexFromDisk(
  path: string,
  legacyPath: string,
): Promise<{ version: typeof CURRENT_VERSION; tasks: Task[] }> {
  let raw: string
  let sourcePath = path
  try {
    raw = await readFile(path, "utf8")
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "ENOENT") throw err
    // Gated, not unconditional: after the daemon migration marker lands the
    // legacy file is a stale snapshot (see readableLegacyIndexPath).
    const legacy = readableLegacyIndexPath(path, legacyPath)
    let legacyRaw: string | undefined
    if (legacy) {
      try {
        legacyRaw = await readFile(legacy, "utf8")
        sourcePath = legacy
      } catch (legacyErr) {
        if ((legacyErr as NodeJS.ErrnoException).code !== "ENOENT") throw legacyErr
      }
    }
    if (legacyRaw === undefined) {
      return { version: CURRENT_VERSION, tasks: [] }
    }
    raw = legacyRaw
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    // Back up FIRST: the next save replaces the corrupt file.
    const backup = await backupCorruptManifest(sourcePath)
    warnManifestRecovery(
      `[rove] tasks.json at ${sourcePath} is corrupted (${(err as Error).message}); recovering with empty index.${
        backup ? ` Original bytes backed up to ${backup}.` : " Backup copy failed; the stale file is left in place."
      }`,
      sourcePath,
    )
    return { version: CURRENT_VERSION, tasks: [] }
  }

  // A future build's manifest gets the same copy-aside.
  if (await recoverUnsupportedVersion(parsed, sourcePath)) {
    return { version: CURRENT_VERSION, tasks: [] }
  }

  return normalizeIndex(parsed, sourcePath)
}
