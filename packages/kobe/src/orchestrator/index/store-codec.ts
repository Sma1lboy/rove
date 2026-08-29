/**
 * Pure I/O internals for {@link TaskIndexStore} (`store.ts`).
 *
 * `this`-independent concerns that would otherwise bloat the store:
 *
 *   - **Lock-retry policy.** {@link acquireWithRetry} wraps the raw
 *     `lockfile.ts` `acquire` with the fixed-backoff wait a contended
 *     machine needs, so the store's `doSave` critical section is a plain
 *     acquire/try/release.
 *   - **On-disk codec.** {@link normalizeIndex} + {@link coerceTask} turn an
 *     arbitrary parsed JSON value into a v3 task list, migrating v1/v2
 *     manifests by stripping dropped fields and self-healing legacy status
 *     rows.
 *   - **Read-merge-write helpers.** {@link readDiskIndex} + {@link mergeTasksWithDisk}
 *     implement the disk side of the save protocol: a fresh read of the
 *     manifest (tasks + deletion tombstones) and the three-way merge between
 *     in-memory intent and on-disk state. Both are stateless and live here so
 *     the store class focuses on the mutable cache / dirty tracking /
 *     persistence orchestration.
 *
 * All functions here are `this`-independent — moved out verbatim so the
 * store class stays under the file-size cap.
 */

import { copyFile, readFile } from "node:fs/promises"
import type {
  Task,
  TaskDeletionState,
  TaskDispatcher,
  TaskLinkedWorkItem,
  TaskPRStatus,
  TaskQuotaResumeState,
  TaskStatus,
  TaskTombstone,
} from "../../types/task.ts"
import { toTaskId } from "../../types/task.ts"
import { coerceVendorId } from "../../types/vendor.ts"
import { LockfileError, acquire } from "./lockfile.ts"

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
 * destroying whatever tasks its bytes still held (ported from PR #276).
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

/**
 * Normalize an arbitrary JSON value into a v3 cache. Migrates v1 / v2
 * manifests by stripping the dropped fields (`tabs`, `activeTabId`,
 * `sessionId`, `model`, `modelEffort`, `permissionMode`). The first
 * save after load persists the v3 shape.
 */
export function normalizeIndex(parsed: unknown, source: string): { version: typeof CURRENT_VERSION; tasks: Task[] } {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn(`[rove] tasks.json at ${source} is not an object; recovering with empty index.`)
    return { version: CURRENT_VERSION, tasks: [] }
  }

  const obj = parsed as { version?: unknown; tasks?: unknown }
  const version = obj.version
  if (version !== undefined && version !== 1 && version !== 2 && version !== 3) {
    console.warn(
      `[rove] tasks.json at ${source} has unsupported version=${String(version)}; recovering with empty index.`,
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
    sourcePath = legacyPath
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
 *     suppress the task, even if we hold it dirty (issue #47 — task ids are
 *     ULIDs and never reused, so a tombstone can't shadow a legit new task).
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
 * Coerce one persisted task entry into a v3 {@link Task}. Tolerant of
 * v1 / v2 shapes — silently drops the dropped fields.
 */
function coerceTask(value: unknown): Task | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  if (
    typeof v.id !== "string" ||
    typeof v.title !== "string" ||
    typeof v.repo !== "string" ||
    typeof v.branch !== "string" ||
    typeof v.worktreePath !== "string" ||
    typeof v.status !== "string" ||
    typeof v.createdAt !== "string" ||
    typeof v.updatedAt !== "string"
  ) {
    return null
  }
  if (!isTaskStatus(v.status)) return null

  // A `main` (project root) task has NO session lifecycle that maintains
  // its status — nothing ever flips it to in_progress on a turn start or
  // back to backlog on a turn end. So a persisted in_progress/done on a
  // main row is junk. Reset a main row to a neutral backlog so the
  // project's liveness comes ONLY from a real live engine handle.
  const kind: Task["kind"] = v.kind === "main" ? "main" : v.kind === "dir" ? "dir" : "task"
  // Scratch only means anything on a dir task — a corrupt flag elsewhere is
  // dropped rather than inventing a Scratch worktree row.
  const scratch = kind === "dir" && v.scratch === true
  const healedStatus: TaskStatus =
    kind === "main" && (v.status === "in_progress" || v.status === "done") ? "backlog" : v.status
  const deletion = coerceDeletion(v.deletion)
  const quotaResume = coerceQuotaResume(v.quotaResume)
  const linkedWorkItem = coerceLinkedWorkItem(v.linkedWorkItem)
  const dispatcher = coerceDispatcher(v.dispatcher)

  return {
    id: toTaskId(v.id),
    title: v.title,
    repo: v.repo,
    branch: v.branch,
    worktreePath: v.worktreePath,
    status: healedStatus,
    pinned: typeof v.pinned === "boolean" ? v.pinned : false,
    kind,
    ...(scratch ? { scratch: true } : {}),
    vendor: coerceVendorId(typeof v.vendor === "string" ? v.vendor : undefined),
    // Raw launch command (`add --command` / `set-command`) — must survive
    // the load coercion or the task falls back to its protocol's preset on
    // every daemon restart, silently dropping the user's own command line.
    ...(typeof v.command === "string" && v.command.trim().length > 0 ? { command: v.command } : {}),
    prStatus: coercePRStatus(v.prStatus),
    // Web-board ordering key — must survive the load coercion or every
    // daemon restart silently forgets the user's column order.
    ...(typeof v.position === "number" && Number.isFinite(v.position) ? { position: v.position } : {}),
    // Engine reasoning/effort level — must survive the load coercion or the
    // task forgets its effort on every daemon restart.
    ...(typeof v.modelEffort === "string" && v.modelEffort.length > 0 ? { modelEffort: v.modelEffort } : {}),
    // Fan-out round marker — must survive the load coercion or siblings
    // lose their grouping on every daemon restart.
    ...(typeof v.groupId === "string" && v.groupId.length > 0 ? { groupId: v.groupId } : {}),
    ...(deletion ? { deletion } : {}),
    // The optional records below were written to disk but silently dropped
    // on load, so each survived only until the next daemon restart: a
    // pending quota resume was forgotten by the very runner whose
    // durability rationale is "absolute timestamp on disk", and a task
    // lost the tracker item it was started from.
    ...(quotaResume ? { quotaResume } : {}),
    ...(linkedWorkItem ? { linkedWorkItem } : {}),
    // Reply address for the collaboration loop (issue #21) — must survive the
    // load coercion or a daemon restart severs every sub-task's route home.
    // Records that predate the field normalize to undefined.
    ...(dispatcher ? { dispatcher } : {}),
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  }
}

function coerceDispatcher(value: unknown): TaskDispatcher | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.taskId !== "string" || v.taskId.length === 0) return undefined
  if (typeof v.tabId !== "string" || v.tabId.length === 0) return undefined
  return { taskId: v.taskId, tabId: v.tabId }
}

function coerceQuotaResume(value: unknown): TaskQuotaResumeState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.resumeAt !== "string" || v.resumeAt.length === 0) return undefined
  if (typeof v.requestedAt !== "string" || v.requestedAt.length === 0) return undefined
  return { resumeAt: v.resumeAt, requestedAt: v.requestedAt }
}

function coerceLinkedWorkItem(value: unknown): TaskLinkedWorkItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (v.provider !== "github") return undefined
  if (v.type !== "issue" && v.type !== "pr") return undefined
  if (typeof v.number !== "number" || !Number.isFinite(v.number)) return undefined
  if (typeof v.title !== "string" || typeof v.url !== "string" || v.url.length === 0) return undefined
  return { provider: v.provider, type: v.type, number: v.number, title: v.title, url: v.url }
}

function coerceDeletion(value: unknown): TaskDeletionState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (
    (v.phase !== "queued" && v.phase !== "running" && v.phase !== "error") ||
    typeof v.force !== "boolean" ||
    typeof v.requestedAt !== "string" ||
    v.requestedAt.length === 0 ||
    (v.error !== undefined && typeof v.error !== "string")
  ) {
    return undefined
  }
  return {
    phase: v.phase,
    force: v.force,
    // Delete-branch opt-in — must survive the load coercion or a daemon
    // restart silently downgrades the user's "delete branch too" to keep.
    ...(typeof v.deleteBranch === "boolean" ? { deleteBranch: v.deleteBranch } : {}),
    requestedAt: v.requestedAt,
    ...(typeof v.error === "string" ? { error: v.error } : {}),
  }
}

function coercePRStatus(value: unknown): TaskPRStatus | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (!isPRProviderId(v.provider) || !isPRLifecycleState(v.lifecycle) || !isPRCheckState(v.checkState)) {
    return undefined
  }
  return {
    provider: v.provider,
    lifecycle: v.lifecycle,
    checkState: v.checkState,
    ...(typeof v.number === "number" && Number.isFinite(v.number) ? { number: v.number } : {}),
    ...(typeof v.url === "string" ? { url: v.url } : {}),
    ...(typeof v.title === "string" ? { title: v.title } : {}),
    ...(typeof v.baseRef === "string" ? { baseRef: v.baseRef } : {}),
    ...(typeof v.headRef === "string" ? { headRef: v.headRef } : {}),
    ...(typeof v.reviewDecision === "string" ? { reviewDecision: v.reviewDecision } : {}),
    ...(typeof v.mergeable === "string" ? { mergeable: v.mergeable } : {}),
    ...(typeof v.lastCheckedAt === "string" ? { lastCheckedAt: v.lastCheckedAt } : {}),
    ...(typeof v.lastError === "string" ? { lastError: v.lastError } : {}),
  }
}

function isPRProviderId(v: unknown): v is TaskPRStatus["provider"] {
  return v === "github" || v === "gitlab" || v === "bitbucket" || v === "unknown"
}

function isPRLifecycleState(v: unknown): v is TaskPRStatus["lifecycle"] {
  return (
    v === "creating" || v === "open" || v === "ready_to_merge" || v === "merged" || v === "closed" || v === "unknown"
  )
}

function isPRCheckState(v: unknown): v is TaskPRStatus["checkState"] {
  return v === "none" || v === "pending" || v === "passing" || v === "failing" || v === "unknown"
}

function isTaskStatus(s: string): s is TaskStatus {
  return (
    s === "backlog" || s === "in_progress" || s === "in_review" || s === "done" || s === "canceled" || s === "error"
  )
}
