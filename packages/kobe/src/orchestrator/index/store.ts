/**
 * The {@link TaskIndex} at `<homeDir>/.rove/tasks.json`. Cross-process safety
 * is `lockfile.ts`; atomicity is here (write-tmp + fsync + rename). Listeners
 * fire after every mutation.
 */

import { mkdir, open, rename, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { readRoveHomeDirEnv } from "@sma1lboy/kobe-daemon/compat-env"
import { LEGACY_KOBE_STATE_DIR_BASENAME, ROVE_STATE_DIR_BASENAME } from "../../product.ts"
import type { Task, TaskId, TaskIndex } from "../../types/task.ts"
import { DEFAULT_TASK_VENDOR, toTaskId } from "../../types/task.ts"
import { release } from "./lockfile.ts"
import { acquireWithRetry, mergeTasksWithDisk, readDiskIndex, recoverIndexFromDisk } from "./store-codec.ts"
import { ulid } from "./ulid.ts"

export interface TaskIndexStoreOptions {
  /**
   * Omitted ≠ OS home: falls back to `ROVE_HOME_DIR`/`KOBE_HOME_DIR` first.
   * Load-bearing — every isolation recipe uses those variables, and
   * `openLocalOrchestrator` constructs this store with no options.
   */
  readonly homeDir?: string
}

/** `id`, `createdAt`, `updatedAt` are auto-assigned. */
export type TaskCreateInput = Omit<Task, "id" | "createdAt" | "updatedAt">

const CURRENT_VERSION = 3 as const

export type TaskIndexListener = (snapshot: readonly Task[]) => void
export type TaskIndexUnsubscribe = () => void

/** Load once, then read synchronously from memory; each mutator persists immediately. */
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

  get filePath(): string {
    return this.path
  }

  /** Also holds the lockfile. */
  get stateDir(): string {
    return this.roveDir
  }

  async load(): Promise<TaskIndex> {
    // Memory now matches disk: no pending changes to protect.
    this.dirtyIds.clear()
    this.removedIds.clear()
    this.cache = await recoverIndexFromDisk(this.path, this.legacyPath)
    this.loaded = true
    this.notifyListeners()
    return this.snapshot()
  }

  /**
   * Serialized behind any in-flight save. Contract: **a rejection means
   * nothing was written** — {@link doSave} never lets a post-rename failure escape.
   */
  async save(): Promise<void> {
    this.assertLoaded()
    const next = this.saveChain.then(() => this.doSave())
    this.saveChain = next.catch(() => {})
    return next
  }

  /**
   * Persist an already-applied cache mutation; undo it if the write fails.
   * Otherwise the entry stays cached and dirty, and the next unrelated save
   * flushes it — e.g. a `create --prompt` task materialising after the caller
   * gave up, with no worktree, branch or engine.
   *
   * `undo` reverts by OBJECT IDENTITY and reports whether it did: a newer
   * mutation that replaced/removed our entry owns the id (and its own save),
   * so it and the dirty flag are left alone. Re-notify after a real undo: a
   * concurrent save may already have pushed the optimistic value.
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

    // Snapshot BEFORE awaiting: in-process mutations queued behind us on
    // `saveChain` keep accumulating into the live sets for their own save.
    const dirty = new Set(this.dirtyIds)
    const removed = new Map(this.removedIds)

    // Serialize read-merge-write across processes (TUI + daemon + CLI); held
    // only for this critical section.
    const lockToken = await acquireWithRetry(this.lockPath)
    // Notify only after release so a slow listener never sits in the lock.
    let cacheChanged = false
    try {
      const disk = await readDiskIndex(this.path, this.legacyPath)
      const merged = mergeTasksWithDisk(this.cache.tasks, disk.tasks, dirty, removed, disk.removed)
      const payload: TaskIndex = {
        version: CURRENT_VERSION,
        tasks: merged.tasks,
        ...(merged.removed.length > 0 ? { removed: merged.removed } : {}),
      }
      // Compact: every mutation rewrites the whole machine-read file, and
      // pretty-printing tripled the bytes.
      const json = `${JSON.stringify(payload)}\n`

      // Unique per save: a shared `<path>.tmp` lets a second writer clobber the
      // first's staging file if exclusion breaks, failing its rename with ENOENT.
      const tmpPath = `${this.path}.${process.pid}.${ulid()}.tmp`
      try {
        // 0600: titles are user prose and records name repo paths.
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

      // Durable now. Clear only the snapshotted ids so changes queued during the
      // write keep their own save; removals live on as on-disk tombstones.
      for (const id of dirty) this.dirtyIds.delete(id)
      for (const id of removed.keys()) this.removedIds.delete(id)

      // Fold in peer creates. Only ADD — never overwrite a cache entry a
      // mutation touched while we were writing.
      const present = new Set(this.cache.tasks.map((t) => t.id))
      for (const task of merged.tasks) {
        if (present.has(task.id)) continue
        this.cache.tasks.push(task)
        cacheChanged = true
      }

      // Evict peer-tombstoned ids, or this process lists a row that no longer
      // exists forever. Only TOMBSTONED ids: an entry the merge never saw (a
      // create during the write) must survive.
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
      // Release is the only post-rename failure point; swallowing it keeps
      // save()'s "rejection = nothing written" contract (a rethrow would make
      // mutators undo a change already on disk). A stale lock is the lesser
      // harm; the next acquirer's staleness check clears it.
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

  /** Ignores `id`/`createdAt` in the patch; bumps `updatedAt`. */
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
   * Focus-switch hot path: bump `updatedAt` in memory and notify (so `recent`
   * reorders live), mark dirty, and let the NEXT real save flush it — no
   * fsync'd {@link doSave} per switch. The last-focused id is persisted
   * eagerly by `state/last-active.ts`; only `recent` ordering across a hard
   * restart rides the lazy flush (best-effort). No-op on an unknown id.
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

  /** Move within `withinIds` so UI partitions (pinned vs regular) stay intact. */
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
      // Restore the ORIGINAL object (and `updatedAt`). Clamp: a concurrent
      // create may have shifted the tail; position is best-effort, value isn't.
      this.cache.tasks.splice(at, 1)
      this.cache.tasks.splice(Math.min(fromIdx, this.cache.tasks.length), 0, moved)
      return true
    })
    this.notifyListeners()
    return next
  }

  /**
   * Returns whether there was a task to delete. Unlike `update`/`move`, an
   * unknown id doesn't throw: a daemon replaying a queued deletion after
   * restart finding nothing is success. The boolean lets a caller whose cache
   * never saw the task tell that apart from a deletion.
   *
   * Rolls back on a failed write; otherwise the row leaves the sidebar, the
   * task stays on disk with `deletion.phase` `running` (restored next launch
   * though its worktree is gone), and the tombstone lingers for the next
   * unrelated save to complete the deletion silently.
   */
  async remove(id: TaskId | string): Promise<boolean> {
    this.assertLoaded()
    const idx = this.cache.tasks.findIndex((t) => t.id === id)
    const removed = this.cache.tasks[idx]
    if (idx < 0 || !removed) return false
    this.cache.tasks.splice(idx, 1)
    // Persisted as a tombstone so neither our merge nor a peer holding the
    // task dirty writes it back.
    this.dirtyIds.delete(String(id))
    this.removedIds.set(String(id), new Date().toISOString())
    await this.saveOrRollback(String(id), () => {
      // If anything put this id back meanwhile, that mutation owns it.
      if (this.cache.tasks.some((t) => t.id === removed.id)) return false
      // A lingering tombstone would let a later save finish the rejected delete.
      this.removedIds.delete(String(id))
      // Clamp: position is best-effort, the restored entry is not.
      this.cache.tasks.splice(Math.min(idx, this.cache.tasks.length), 0, removed)
      return true
    })
    this.notifyListeners()
    return true
  }

  /** Tolerates an already-missing file. */
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
