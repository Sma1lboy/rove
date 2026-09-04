/**
 * The on-disk task index (v0.6).
 *
 * Persists the {@link TaskIndex} at `<homeDir>/.rove/tasks.json`. Single
 * writer per machine — multi-process safety lives in `lockfile.ts`,
 * write atomicity lives here (write-tmp + fsync + rename).
 *
 * Writes are atomic, malformed JSON is backed up before recovery, v1/v2
 * manifests normalize on load, and listeners fire after every mutation.
 */

import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { readRoveHomeDirEnv } from "@sma1lboy/kobe-daemon/compat-env"
import { LEGACY_KOBE_STATE_DIR_BASENAME, ROVE_STATE_DIR_BASENAME } from "../../product.ts"
import type { Task, TaskId, TaskIndex, TaskStatus } from "../../types/task.ts"
import { DEFAULT_TASK_VENDOR, toTaskId } from "../../types/task.ts"
import { release } from "./lockfile.ts"
import { acquireWithRetry, mergeTasksWithDisk, readDiskIndex, recoverIndexFromDisk } from "./store-codec.ts"
import { ulid } from "./ulid.ts"

export interface TaskIndexStoreOptions {
  /**
   * Override the user's home dir. Tests use this to write into tmp.
   *
   * Omitting it does NOT mean the OS home: the constructor falls back to
   * `ROVE_HOME_DIR`/`KOBE_HOME_DIR` first. That default is load-bearing —
   * every isolation recipe in this repo is those variables, and the CLI's
   * daemon-down write fallback (`openLocalOrchestrator`) constructs this
   * store with no options at all.
   */
  readonly homeDir?: string
}

/**
 * Input shape for {@link TaskIndexStore.create}. `id`, `createdAt`,
 * `updatedAt` are auto-assigned.
 */
export type TaskCreateInput = Omit<Task, "id" | "createdAt" | "updatedAt">

const CURRENT_VERSION = 3 as const

export type TaskIndexListener = (snapshot: readonly Task[]) => void
export type TaskIndexUnsubscribe = () => void

/**
 * Persistent store for the Rove task manifest.
 *
 * Callers load once, then operate synchronously against the in-memory copy;
 * each mutating method persists immediately.
 */
export class TaskIndexStore {
  private readonly homeDir: string
  private readonly roveDir: string
  private readonly path: string
  private readonly legacyPath: string
  private readonly lockPath: string
  private cache: { version: typeof CURRENT_VERSION; tasks: Task[] } = { version: CURRENT_VERSION, tasks: [] }
  private loaded = false
  private listeners = new Set<TaskIndexListener>()
  private saveChain: Promise<void> = Promise.resolve()
  /** Pending changed/removed ids used by the read-merge-write in {@link doSave}. */
  private readonly dirtyIds = new Set<string>()
  /** Pending removals, id → deletion ISO time (becomes the tombstone's `at`). */
  private readonly removedIds = new Map<string, string>()

  constructor(options: TaskIndexStoreOptions = {}) {
    this.homeDir = options.homeDir ?? readRoveHomeDirEnv() ?? homedir()
    this.roveDir = join(this.homeDir, ROVE_STATE_DIR_BASENAME)
    this.path = join(this.roveDir, "tasks.json")
    this.legacyPath = join(this.homeDir, LEGACY_KOBE_STATE_DIR_BASENAME, "tasks.json")
    this.lockPath = `${this.path}.lock`
  }

  subscribe(listener: TaskIndexListener): TaskIndexUnsubscribe {
    this.listeners.add(listener)
    if (this.loaded) {
      try {
        listener(this.cache.tasks.slice())
      } catch (err) {
        console.error("[rove TaskIndexStore] listener threw on subscribe:", err)
      }
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Absolute path to the manifest file. Tests inspect this. */
  get filePath(): string {
    return this.path
  }

  /** Absolute path to the Rove state dir. Lockfile lives here too. */
  get stateDir(): string {
    return this.roveDir
  }

  async load(): Promise<TaskIndex> {
    // A fresh load makes the in-memory copy match disk, so there are no
    // pending local changes to protect during the next merge.
    this.dirtyIds.clear()
    this.removedIds.clear()
    this.cache = await recoverIndexFromDisk(this.path, this.legacyPath)
    this.loaded = true
    this.notifyListeners()
    return this.snapshot()
  }

  /**
   * Flush pending changes, serialized behind any save already in flight.
   *
   * Contract the mutators rely on: **a rejection means nothing was written.**
   * {@link doSave} upholds it by never letting a failure that happens AFTER
   * the manifest rename escape — see the release handler there.
   */
  async save(): Promise<void> {
    this.assertLoaded()
    const next = this.saveChain.then(() => this.doSave())
    this.saveChain = next.catch(() => {})
    return next
  }

  /**
   * Persist a mutation that has ALREADY been applied to the cache, and undo
   * that change when the write does not land.
   *
   * Without the undo a reported failure becomes a delayed success: the entry
   * stays in the cache (so `get`/`list` and every UI reading them show it)
   * and stays in `dirtyIds`, so the next UNRELATED successful save flushes
   * someone else's failed write to disk minutes later. For `create --prompt`
   * that is a task materialising after the caller gave up — no worktree, no
   * branch, no engine, and nobody expecting it.
   *
   * `undo` reverts by OBJECT IDENTITY and reports whether it did: if a newer
   * mutation has since replaced or removed our entry, that mutation owns the
   * id (and carries its own save), so we leave both it and the dirty flag
   * alone. Listeners are re-notified after a real undo because a concurrent
   * mutation's successful save can already have pushed a snapshot carrying
   * the optimistic value.
   */
  private async saveOrRollback(id: string, undo: () => boolean): Promise<void> {
    try {
      await this.save()
    } catch (err) {
      if (undo()) {
        this.dirtyIds.delete(id)
        this.notifyListeners()
      }
      throw err
    }
  }

  private async doSave(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })

    // Snapshot the pending-change sets BEFORE awaiting anything: a peer's
    // changes land via a fresh disk read, but OUR concurrent in-process
    // mutations (queued behind this on `saveChain`) keep accumulating into
    // the live sets and are flushed by their own queued save.
    const dirty = new Set(this.dirtyIds)
    const removed = new Map(this.removedIds)

    // Cross-process mutual exclusion: serialize the read-merge-write so two
    // Rove instances (TUI + daemon + CLI) can't interleave and lose updates.
    // The lock is held only for this critical section, never across saves.
    const lockToken = await acquireWithRetry(this.lockPath)
    // Set when the merge changed our own cache (a peer's create folded in, or
    // a peer's deletion evicted). Notified after the lock is released so a
    // slow listener never sits inside the cross-process critical section.
    let cacheChanged = false
    try {
      const disk = await readDiskIndex(this.path, this.legacyPath)
      const merged = mergeTasksWithDisk(this.cache.tasks, disk.tasks, dirty, removed, disk.removed)
      const payload: TaskIndex = {
        version: CURRENT_VERSION,
        tasks: merged.tasks,
        ...(merged.removed.length > 0 ? { removed: merged.removed } : {}),
      }
      // Compact (no `null, 2`): every mutation rewrites the whole file, the
      // file is read only by machines, and pretty-printing tripled the bytes.
      const json = `${JSON.stringify(payload)}\n`

      // Unique per save: a shared `<path>.tmp` lets a second writer clobber
      // the first's staging file whenever mutual exclusion breaks, failing
      // the survivor's rename with ENOENT.
      const tmpPath = `${this.path}.${process.pid}.${ulid()}.tmp`
      try {
        // 0600: task titles are free-form user prose and every record names a
        // repo path — not credentials, but nobody else's business either.
        const handle = await open(tmpPath, "w", 0o600)
        try {
          await handle.writeFile(json, "utf8")
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(tmpPath, this.path)
      } catch (err) {
        await unlink(tmpPath).catch(() => {})
        throw err
      }

      // The write succeeded, so these changes are now durable: stop protecting
      // them in future merges (clearing only the snapshotted ids leaves any
      // change queued while we were writing intact for its own save). Removals
      // now live on as on-disk tombstones, so dropping them here is safe.
      for (const id of dirty) this.dirtyIds.delete(id)
      for (const id of removed.keys()) this.removedIds.delete(id)

      // Surface concurrent creates a peer made: fold any merged task we didn't
      // already have into the cache so this process's UI sees it too. We only
      // ADD ids (never overwrite an existing cache entry) to avoid clobbering a
      // mutation that ran on the live cache while we were writing.
      const present = new Set(this.cache.tasks.map((t) => t.id))
      for (const task of merged.tasks) {
        if (present.has(task.id)) continue
        this.cache.tasks.push(task)
        cacheChanged = true
      }

      // And drop what the merge DELETED. A task a peer tombstoned is absent
      // from the bytes we just wrote, so keeping it in the cache leaves this
      // process listing a row that no longer exists — and rewriting a file
      // without it — forever, even after its own read-merge-write. Only
      // TOMBSTONED ids are evicted: a cache entry the merge simply never saw
      // (a create that ran on the live cache while we were writing) must
      // survive, which is the same reason the fold above only ever adds.
      const tombstoned = new Set(merged.removed.map((t) => t.id))
      if (tombstoned.size > 0) {
        for (let i = this.cache.tasks.length - 1; i >= 0; i--) {
          const entry = this.cache.tasks[i]
          if (!entry || !tombstoned.has(entry.id)) continue
          this.cache.tasks.splice(i, 1)
          cacheChanged = true
        }
      }
    } finally {
      // Releasing the lock is the ONLY thing here that can fail after the
      // rename made the write durable, and it must never decide the save's
      // outcome: the mutators undo their cache change when save() rejects, so
      // rethrowing here would leave the cache contradicting a file already on
      // disk — the exact report/state disagreement the rollback exists to end.
      // Swallowing it is what keeps save()'s contract true: every remaining
      // throw site sits BEFORE the rename, so a rejection means nothing was
      // written. A stale lock is the lesser harm and the next acquirer's
      // staleness check clears it.
      await release(this.lockPath, lockToken).catch((err) => {
        console.error("[rove TaskIndexStore] index lock release failed:", err)
      })
    }
    if (cacheChanged) this.notifyListeners()
  }

  get(id: TaskId | string): Task | undefined {
    this.assertLoaded()
    return this.cache.tasks.find((t) => t.id === id)
  }

  list(): Task[] {
    this.assertLoaded()
    return this.cache.tasks.slice()
  }

  async create(partial: TaskCreateInput): Promise<Task> {
    this.assertLoaded()
    const now = new Date().toISOString()
    const task: Task = {
      vendor: partial.vendor ?? DEFAULT_TASK_VENDOR,
      ...partial,
      id: toTaskId(ulid()),
      createdAt: now,
      updatedAt: now,
    }
    this.cache.tasks.push(task)
    this.dirtyIds.add(task.id)
    await this.saveOrRollback(task.id, () => {
      const at = this.cache.tasks.indexOf(task)
      if (at < 0) return false
      this.cache.tasks.splice(at, 1)
      return true
    })
    this.notifyListeners()
    return task
  }

  /**
   * Patch a task. Refuses to touch immutable fields (`id`, `createdAt`).
   * Bumps `updatedAt` to now and persists.
   */
  async update(id: TaskId | string, patch: Partial<Task>): Promise<Task> {
    this.assertLoaded()
    const idx = this.cache.tasks.findIndex((t) => t.id === id)
    if (idx < 0) throw new Error(`task not found: ${id}`)
    const existing = this.cache.tasks[idx]
    if (!existing) throw new Error(`task not found: ${id}`)

    const { id: _id, createdAt: _createdAt, ...mutable } = patch
    void _id
    void _createdAt

    const next: Task = {
      ...existing,
      ...mutable,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }
    this.cache.tasks[idx] = next
    this.dirtyIds.add(String(id))
    await this.saveOrRollback(String(id), () => {
      const at = this.cache.tasks.indexOf(next)
      if (at < 0) return false
      this.cache.tasks[at] = existing
      return true
    })
    this.notifyListeners()
    return next
  }

  /**
   * Bump `updatedAt` to now for recency ONLY — the focus-switch hot path.
   *
   * `setActiveTask` is the most frequent action in the TUI (every task/focus
   * switch), and it only needs `updatedAt` moved so the sidebar's `recent`
   * sort tracks focus order. Routing that through {@link update} with an empty
   * patch would pay a full fsync'd read-merge-write ({@link doSave}) on EVERY
   * switch, all to move one field the default sort never reads.
   *
   * This bumps `updatedAt` in the in-memory cache and notifies listeners (so
   * `recent` reorders LIVE, this session, from the pushed snapshot), then marks
   * the id dirty so the new value is flushed lazily by the NEXT real mutation's
   * save — no fsync on the hot path. Durability of the single last-focused id
   * is already handled separately + eagerly by `state/last-active.ts` (a fresh
   * orchestrator restores focus from there), so the only thing riding the lazy
   * flush is the finer-grained `recent` ORDERING across a hard restart, which
   * is best-effort and re-established as tasks get real writes. No-op on an
   * unknown id.
   */
  touchRecency(id: TaskId | string): void {
    this.assertLoaded()
    const idx = this.cache.tasks.findIndex((t) => t.id === id)
    if (idx < 0) return
    const existing = this.cache.tasks[idx]
    if (!existing) return
    this.cache.tasks[idx] = { ...existing, updatedAt: new Date().toISOString() }
    this.dirtyIds.add(String(id))
    this.notifyListeners()
  }

  /**
   * Move a task up/down inside a caller-defined subset of task ids.
   * The subset lets UI ordering rules keep their partitions intact
   * (e.g. regular tasks move among regular tasks, pinned among pinned).
   */
  async move(id: TaskId | string, delta: -1 | 1, withinIds?: readonly string[]): Promise<Task> {
    this.assertLoaded()
    const task = this.cache.tasks.find((t) => t.id === id)
    if (!task) throw new Error(`task not found: ${id}`)
    const ids = withinIds?.length ? withinIds : this.cache.tasks.map((t) => t.id)
    const pos = ids.indexOf(String(id))
    if (pos < 0) throw new Error(`task not movable in current group: ${id}`)
    const targetId = ids[pos + delta]
    if (!targetId) return task

    const fromIdx = this.cache.tasks.findIndex((t) => t.id === id)
    const toIdx = this.cache.tasks.findIndex((t) => t.id === targetId)
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return task

    const [moved] = this.cache.tasks.splice(fromIdx, 1)
    if (!moved) return task
    const adjustedToIdx = fromIdx < toIdx ? toIdx - 1 : toIdx
    const insertAt = delta > 0 ? adjustedToIdx + 1 : adjustedToIdx
    const next: Task = { ...moved, updatedAt: new Date().toISOString() }
    this.cache.tasks.splice(insertAt, 0, next)
    this.dirtyIds.add(String(id))
    await this.saveOrRollback(String(id), () => {
      const at = this.cache.tasks.indexOf(next)
      if (at < 0) return false
      // Put the ORIGINAL object back (restoring `updatedAt` too) at the index
      // it came from. A concurrent create can have shifted the tail, so clamp
      // — position is best-effort here, the reverted value is not.
      this.cache.tasks.splice(at, 1)
      this.cache.tasks.splice(Math.min(fromIdx, this.cache.tasks.length), 0, moved)
      return true
    })
    this.notifyListeners()
    return next
  }

  /**
   * Delete a task. Returns whether there was one to delete.
   *
   * Deliberately does NOT throw like its siblings `update`/`move` do on an
   * unknown id: the daemon replays a queued deletion after a restart, and a
   * replay finding nothing left is success, not an error. But returning
   * `void` made "deleted" and "there was nothing here" the same answer — a
   * caller working from a cache that never saw the task (a peer created it)
   * got a silent no-op indistinguishable from a deletion. Hence the boolean.
   */
  async remove(id: TaskId | string): Promise<boolean> {
    this.assertLoaded()
    const idx = this.cache.tasks.findIndex((t) => t.id === id)
    if (idx < 0) return false
    this.cache.tasks.splice(idx, 1)
    // Record the deletion so the read-merge-write doesn't resurrect this task
    // from a stale on-disk copy, and stop treating it as a pending edit. The
    // save persists it as a tombstone so PEER writers that still hold the
    // task dirty in memory don't write it back either.
    this.dirtyIds.delete(String(id))
    this.removedIds.set(String(id), new Date().toISOString())
    await this.save()
    this.notifyListeners()
    return true
  }

  /**
   * Remove the manifest file from disk. Used in tests and at uninstall.
   * Tolerant of "already gone".
   */
  async _unlinkForTests(): Promise<void> {
    try {
      await unlink(this.path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    }
    this.cache = { version: CURRENT_VERSION, tasks: [] }
    this.loaded = false
    this.dirtyIds.clear()
    this.removedIds.clear()
  }

  // --- internals ---

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new Error("TaskIndexStore: call load() before any other method")
    }
  }

  private snapshot(): TaskIndex {
    return {
      version: CURRENT_VERSION,
      tasks: this.cache.tasks.slice(),
    }
  }

  private notifyListeners(): void {
    if (this.listeners.size === 0) return
    const snapshot = this.cache.tasks.slice()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch (err) {
        console.error("[rove TaskIndexStore] listener threw on notify:", err)
      }
    }
  }
}
