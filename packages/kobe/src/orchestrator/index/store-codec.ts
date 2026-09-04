/**
 * Pure I/O internals for {@link TaskIndexStore} (`store.ts`).
 *
 * `this`-independent concerns that would otherwise bloat the store:
 *
 *   - **Lock-retry policy.** {@link acquireWithRetry} wraps the raw
 *     `lockfile.ts` `acquire` with the fixed-backoff wait a contended
 *     machine needs, so the store's `doSave` critical section is a plain
 *     acquire/try/release.
 *   - **On-disk codec.** {@link normalizeIndex} turns an arbitrary parsed JSON
 *     value into a v3 task list, migrating v1/v2 manifests. The per-ROW half
 *     of that — one entry → a {@link Task}, field by field — lives in
 *     `store-codec-rows.ts`; the seam is manifest scope vs row scope.
 *   - **Load-time recovery ladder.** {@link recoverIndexFromDisk} walks
 *     missing file → gated legacy twin → corrupt JSON → future-build version,
 *     each rung ending in an empty index with the original bytes copied
 *     aside. It answers "what does this manifest mean"; the store only wants
 *     the cache that falls out.
 *   - **Read-merge-write helpers.** {@link readDiskIndex} + {@link mergeTasksWithDisk}
 *     implement the disk side of the save protocol: a fresh read of the
 *     manifest (tasks + deletion tombstones) and the three-way merge between
 *     in-memory intent and on-disk state. Both are stateless and live here so
 *     the store class focuses on the mutable cache / dirty tracking /
 *     persistence orchestration.
 *
 * The seam is `this`: every function here is stateless, so the versions the
 * codec must tolerate can be fed in as plain values and the merge protocol
 * checked without a store, a lock, or a real manifest on disk. The store keeps
 * the mutable half — cache, dirty tracking, when to persist.
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
/**
 * How long to keep retrying before giving up. Holds are millisecond-scale
 * (one read-merge-write), so 5s is generous headroom for a contended machine;
 * past it we surface the {@link LockfileError} rather than block a UI thread.
 */
const LOCK_MAX_WAIT_MS = 5_000

/**
 * Acquire the index lock, retrying with a fixed backoff while it's held by a
 * *live* peer. {@link acquire} rejects immediately on a live holder (and steals
 * a stale one on its own), so the wait policy lives here. Non-contention errors
 * (and a blown deadline) propagate to the caller. Returns the ownership token
 * to pass to `release`.
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
 * Copy a corrupt manifest's ORIGINAL bytes aside before the store recovers
 * to an empty index. Without this, the next save read-merge-writes from the
 * empty recovery base and REPLACES the corrupt file — permanently
 * destroying whatever tasks its bytes still held.
 * Best-effort: a backup failure must never block startup/save; returns the
 * backup path for the caller's warn line, or null when the copy failed.
 */
export async function backupCorruptManifest(path: string, now: () => Date = () => new Date()): Promise<string | null> {
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

/**
 * Warn about a manifest recovery on BOTH sinks. `console.warn` alone is
 * invisible in normal use: every pane runs inside an opentui alternate
 * screen that paints straight over stdout/stderr, which is the entire
 * reason `client-log.ts` exists. A recovery that silently empties the task
 * index must leave a trace a human can actually find afterwards.
 */
export function warnManifestRecovery(message: string, manifestPath?: string): void {
  console.warn(message)
  // `<home>/.rove|.kobe/tasks.json` → that same home's client.log. Resolved
  // from the manifest rather than the ambient default so a store opened on an
  // explicit homeDir logs into ITS home, not the invoking user's.
  logClient("tasks-index", message, manifestPath ? defaultClientLogPath(dirname(dirname(manifestPath))) : undefined)
}

/**
 * A manifest stamped with a version this build doesn't know is a FUTURE
 * build's file: the user ran a newer Rove, then went back to an older one.
 * Recovering empty is right (we can't understand the rows), but the next
 * save read-merge-writes from that empty base and REPLACES the file —
 * so the bytes have to be copied aside first, exactly like the corrupt-JSON
 * path does. Same consequence, same protection.
 *
 * Returns true when it handled the value (caller recovers empty).
 */
export async function recoverUnsupportedVersion(parsed: unknown, sourcePath: string): Promise<boolean> {
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
 * Normalize an arbitrary JSON value into a v3 cache. Migrates v1 / v2
 * manifests by stripping the dropped fields (`tabs`, `activeTabId`,
 * `sessionId`, `model`, `modelEffort`, `permissionMode`). The first
 * save after load persists the v3 shape.
 *
 * The unsupported-version guard here is a last-resort net for callers that
 * skipped {@link recoverUnsupportedVersion}; the async read paths run that
 * first so the bytes are backed up before anything empties the index.
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

/**
 * How long a deletion tombstone stays in the manifest before save-time
 * pruning. A tombstone only has to outlive any live writer's in-memory dirty
 * reference to the task (dirty ids flush on that instance's next save), so
 * 30 days is generous headroom and growth stays negligible.
 */
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The legacy `~/.kobe/tasks.json` as a READ fallback, or `undefined` once it
 * is stale. The fallback exists for daemon-free readers (`export`, the
 * orchestrator bridge) on a pre-rename home that no daemon has migrated yet.
 * Once the daemon migration marker sits beside the canonical file, the legacy
 * copy is a frozen snapshot: reading it resurrects every task deleted since
 * the move — the whole index after Settings › Developer › Reset UI state,
 * which unlinks only the canonical file, and any single deletion on the next
 * save (the read-merge-write folds unknown ids back in as concurrent creates).
 */
export function readableLegacyIndexPath(canonicalPath: string, legacyPath: string): string | undefined {
  return existsSync(join(dirname(canonicalPath), DAEMON_MIGRATION_MARKER)) ? undefined : legacyPath
}

/**
 * Read + parse the manifest fresh from disk, returning the tasks and the
 * deletion tombstones. Mirrors {@link TaskIndexStore.load}: a missing
 * canonical file falls back to `legacyPath`, while both absent or a corrupt
 * source read as empty. Never touches the store cache or listeners; used so
 * a save reflects peer writes since this process loaded.
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
  // Same protection as the parse branch above: back the bytes up before the
  // merged write replaces a manifest this build can't read.
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
 * Read-merge-write core: combine the fresh on-disk index with this process's
 * in-memory intent. Invariants (mirroring `state/store.ts`):
 *
 *   - OUR changes win for ids we touched (`dirty`) — last-write-wins per task.
 *   - A DELETION beats a concurrent edit, from either side: our pending
 *     removals (`removed`) and the on-disk tombstones a peer persisted both
 *     suppress the task, even if we hold it dirty (task ids are ULIDs and
 *     never reused, so a tombstone can't shadow a legit new task).
 *   - A task a peer removed pre-tombstones (gone from disk, untouched by us)
 *     is still NOT resurrected from our stale cache.
 *   - A task a peer created/updated (on disk, untouched by us) is preserved —
 *     concurrent creates are never dropped.
 *
 * Returns the merged tasks plus the tombstone set to persist (disk ∪ ours,
 * expired entries pruned).
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

  // 1. Walk our cache in order — it carries our create/update/move intent and
  //    the ordering this process wants persisted.
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

  // 2. Fold in concurrent creates: tasks on disk we've never seen and never
  //    removed. Appended after our ordering.
  for (const task of diskTasks) {
    if (included.has(task.id) || tombstones.has(task.id)) continue
    result.push(task)
    included.add(task.id)
  }

  return { tasks: result, removed: [...tombstones].map(([id, at]) => ({ id, at })) }
}

/**
 * Turn whatever is on disk into a v3 index the store can hold.
 *
 * The seam against `store.ts`: every branch here answers "what does this
 * manifest mean", and every failure answers it with an EMPTY index after
 * copying the original bytes aside. The store does not care which branch ran
 * — it just gets a cache — so the recovery ladder (missing file, gated legacy
 * twin, corrupt JSON, a future build's version) lives with the codec that
 * already owns `normalizeIndex`, `backupCorruptManifest` and the recovery
 * warnings, instead of as a third of the store class.
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
    // Back the original bytes up FIRST: the next save read-merge-writes
    // from this empty recovery base and replaces the corrupt file, so
    // without a copy the user's tasks are gone for good.
    const backup = await backupCorruptManifest(sourcePath)
    warnManifestRecovery(
      `[rove] tasks.json at ${sourcePath} is corrupted (${(err as Error).message}); recovering with empty index.${
        backup ? ` Original bytes backed up to ${backup}.` : " Backup copy failed; the stale file is left in place."
      }`,
      sourcePath,
    )
    return { version: CURRENT_VERSION, tasks: [] }
  }

  // A future build's manifest empties the index just as thoroughly as a
  // corrupt one does, and the next save replaces the file — so its bytes
  // get the same copy-aside before we recover empty.
  if (await recoverUnsupportedVersion(parsed, sourcePath)) {
    return { version: CURRENT_VERSION, tasks: [] }
  }

  return normalizeIndex(parsed, sourcePath)
}
