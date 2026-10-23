import { errorMessage } from "../lib/error-message.ts"
import type { Task, TaskId } from "../types/task.ts"
import { canonPath } from "./core-helpers.ts"
import { CannotDeleteMainTaskError, DirtyWorktreeError, WorktreeRemoveFailedError } from "./errors.ts"
import type { TaskIndexStore } from "./index/store.ts"
import { subtreeIds } from "./task-tree.ts"
import type { WorktreeResidue } from "./worktree/manager-remove.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"
import type { IgnoredWorkProbe } from "./worktree/salvage-ignored.ts"
import type { SalvageRecord } from "./worktree/salvage.ts"

/** `deleteBranch` is never implied by `force`. */
export interface TaskDeletionOpts {
  readonly force?: boolean
  readonly deleteBranch?: boolean
  /** Delete the whole subtree. Default: the task's children are promoted to its own parent. */
  readonly cascade?: boolean
}

/** A queued/running deletion; a failed one (`error`) is retryable and still holds its directory. */
function isLeaving(task: Task): boolean {
  return task.deletion?.phase === "queued" || task.deletion?.phase === "running"
}

/**
 * Persistent task-deletion state machine. The daemon owns scheduling; this
 * collaborator owns safety checks and the atomic task-index transitions.
 *
 * A directory is shared by every row whose canonical `worktreePath` equals it
 * (an owner plus its shared children), so it is physically removed only by
 * the last row standing, never by whichever row happens to be deleted.
 */
export class TaskDeletionCoordinator {
  /** Serialises `finish` per canonical path so two rows of one directory can't each see the other and both skip removal. */
  private readonly pathLocks = new Map<string, Promise<void>>()

  constructor(
    private readonly store: TaskIndexStore,
    private readonly worktrees: GitWorktreeManager,
    private readonly forgetTask: (id: TaskId) => void,
    // The three hooks below feed the deletion audit log: `finish()` removes the
    // task row, so the log (indexed by title + time) is the only record left.
    /** A forced removal salvaged uncommitted work; the recovery ref. */
    private readonly onSalvage?: (taskId: TaskId, record: SalvageRecord) => void,
    /** Deregistered but the directory is still on disk (the deletion succeeds). */
    private readonly onResidue?: (taskId: TaskId, residue: WorktreeResidue) => void,
    /** `deleteBranch` was asked for and git refused; otherwise the log would
     *  confirm a branch deletion that never happened. */
    private readonly onBranchKept?: (taskId: TaskId, kept: { branch: string; reason: string }) => void,
  ) {}

  /** Ids a deletion of `id` covers, deepest first; the single id unless `cascade`. */
  targets(id: TaskId | string, opts?: TaskDeletionOpts): string[] {
    return opts?.cascade ? subtreeIds(this.store.list(), String(id)) : [String(id)]
  }

  /**
   * Persist acceptance after the destructive dirty-worktree safety check. The
   * gate runs over the WHOLE deletion set before anything is queued, so a
   * refusal never leaves half a subtree marked.
   */
  async prepare(id: TaskId | string, opts?: TaskDeletionOpts): Promise<boolean> {
    const task = this.store.get(id)
    if (!task) return false
    if (task.kind === "main") throw new CannotDeleteMainTaskError()
    if (isLeaving(task)) return true
    // Gate + queue per directory, one at a time: two rows deleted together would
    // each see the other as a survivor, skip the dirty gate, and the last one
    // would remove the directory unchecked.
    const keys = this.targets(task.id, opts).flatMap((targetId) => {
      const target = this.store.get(targetId)
      return target?.worktreePath && target.kind !== "dir" ? [canonPath(target.worktreePath)] : []
    })
    return this.withPathLocks([...new Set(keys)].sort(), () => this.prepareLocked(task.id, opts))
  }

  private async prepareLocked(id: TaskId, opts?: TaskDeletionOpts): Promise<boolean> {
    const task = this.store.get(id)
    if (!task || isLeaving(task)) return task !== undefined

    const force = opts?.force === true
    const doomed = this.targets(task.id, opts)
      .map((targetId) => this.store.get(targetId))
      .filter((t): t is Task => t !== undefined && t.kind !== "main" && !isLeaving(t))
    const leaving = new Set(doomed.map((t) => String(t.id)))
    // Rows already on their way out don't keep a directory alive.
    const survivors = this.store.list().filter((t) => !leaving.has(String(t.id)) && !isLeaving(t))

    const gated = new Set<string>()
    for (const target of doomed) {
      // A `dir` task's directory is user-owned and never touched; only the
      // index entry goes, so no dirty gate. Likewise while a surviving row
      // still runs in the directory: nothing is removed, nothing is lost.
      if (!target.worktreePath || force || target.kind === "dir") continue
      const key = canonPath(target.worktreePath)
      if (gated.has(key) || survivors.some((s) => s.worktreePath && canonPath(s.worktreePath) === key)) continue
      gated.add(key)
      let dirty: readonly string[] = []
      // Gitignored files aren't porcelain-dirty but don't survive removal
      // (`HANDOFF.md`, `.scratch/**`, `.env*` here). Porcelain alone let a
      // notes-only worktree delete with no force, confirm or salvage ref.
      let ignored: IgnoredWorkProbe = []
      let probed = true
      try {
        dirty = await this.worktrees.dirtyPaths(target.worktreePath)
      } catch {
        // Missing/unreadable path: remove() resolves it. Skip the ignored
        // probe too — it would answer "unknown" for a hand-removed worktree
        // and block its deletion.
        probed = false
      }
      // Outside that catch, so a failed ignored listing stays "unknown" and
      // never reads as "nothing here".
      if (probed && dirty.length === 0) ignored = await this.worktrees.ignoredWork(target.worktreePath)
      if (dirty.length > 0 || ignored === "unknown" || ignored.length > 0) {
        throw new DirtyWorktreeError(target.id, ignored, dirty)
      }
    }

    for (const target of doomed) {
      await this.store.update(target.id, {
        deletion: {
          phase: "queued",
          force,
          // Never implied by `force`: the branch is git's durable record. A sharer
          // deleted earlier with the flag leaves it on the row that still held the branch.
          deleteBranch: opts?.deleteBranch === true || target.deleteBranchPending === true,
          requestedAt: new Date().toISOString(),
        },
      })
    }
    await this.transferOwnership(leaving)
    if (!opts?.cascade) await this.promoteChildren(task)
    return true
  }

  /** Mark a queued/resumed deletion as actively owned by a daemon runner. */
  async begin(id: TaskId | string): Promise<boolean> {
    const task = this.store.get(id)
    if (!task || !task.deletion || task.deletion.phase === "error") return false
    if (task.deletion.phase !== "running") {
      await this.store.update(task.id, { deletion: { ...task.deletion, phase: "running" } })
    }
    return true
  }

  /** Remove the worktree and task entry; retain a durable error on failure. */
  async finish(id: TaskId | string): Promise<void> {
    const task = this.store.get(id)
    if (!task?.deletion || task.deletion.phase !== "running") return
    // NEVER remove a `dir` task's directory (`rove .`): it's the user's own.
    const ownsDirectory = Boolean(task.worktreePath) && task.kind !== "dir"
    await this.withPathLock(ownsDirectory ? canonPath(task.worktreePath) : null, async () => {
      const key = ownsDirectory ? canonPath(task.worktreePath) : null
      // Only the last row standing on the path removes it.
      const shared =
        key !== null &&
        this.store.list().some((t) => t.id !== task.id && t.worktreePath && canonPath(t.worktreePath) === key)
      try {
        if (ownsDirectory && !shared) await this.removeWorktree(task, task.deletion as NonNullable<Task["deletion"]>)
        else if (ownsDirectory && task.deletion?.deleteBranch) await this.handBranchDeleteOn(task, key)
      } catch (cause) {
        const failure = new WorktreeRemoveFailedError(task.id, cause)
        await this.store.update(task.id, {
          deletion: {
            ...(task.deletion as NonNullable<Task["deletion"]>),
            phase: "error",
            error: errorMessage(failure),
          },
        })
        throw failure
      }
      await this.store.remove(task.id)
      this.forgetTask(task.id)
    })
  }

  /** Compatibility path for local callers that still require completion. */
  async deleteNow(id: TaskId | string, opts?: TaskDeletionOpts): Promise<void> {
    const targets = this.targets(id, opts)
    if (!(await this.prepare(id, opts))) return
    let failure: unknown
    for (const target of targets) {
      try {
        if (await this.begin(target)) await this.finish(target)
      } catch (err) {
        failure ??= err
      }
    }
    if (failure) throw failure
  }

  private async removeWorktree(task: Task, deletion: NonNullable<Task["deletion"]>): Promise<void> {
    await this.worktrees.remove(task.worktreePath, {
      force: deletion.force,
      deleteBranch: deletion.deleteBranch === true,
      // For an already-gone directory: nothing on disk points back at the
      // repo, so its stale admin record can only be pruned via this.
      repo: task.repo,
      // Likewise: normally read from the (now missing) worktree.
      branch: task.branch,
      // `force` was frozen at prepare(); this may run in a later daemon
      // (`resume()` replays after restart) after the tree went dirty.
      // Re-gating would fail a confirmed delete; salvage keeps it
      // recoverable.
      onSalvage: (record) => {
        if (record) this.onSalvage?.(task.id, record)
      },
      // Half-completed removal (deregistered, directory undeletable) is not
      // an error: git forgot the worktree, so retries would fail forever.
      // Finish, report the leftover, never delete it from under the user.
      onResidue: (residue) => this.onResidue?.(task.id, residue),
      // Best-effort (a refused branch never fails the removal), not silent.
      onBranchKept: (kept) => this.onBranchKept?.(task.id, kept),
    })
  }

  /** The branch stays with the rows still on the path; the request moves to one of them, so the last row to leave honours it. */
  private async handBranchDeleteOn(leaving: Task, key: string | null): Promise<void> {
    const holder = this.store
      .list()
      .find((t) => t.id !== leaving.id && t.worktreePath && canonPath(t.worktreePath) === key)
    if (holder && isLeaving(holder)) {
      // Already on its way out: its own frozen request is the one that counts.
      await this.store.update(holder.id, { deletion: { ...holder.deletion!, deleteBranch: true } })
    } else if (holder) await this.store.update(holder.id, { deleteBranchPending: true })
    this.onBranchKept?.(leaving.id, { branch: leaving.branch, reason: "another task still uses this branch" })
  }

  /**
   * An owner leaving while sharers remain hands the directory to the first
   * remaining sharer, so the survivors keep one consistent owner. A sharer
   * that is itself leaving is never promoted.
   */
  private async transferOwnership(leaving: ReadonlySet<string>): Promise<void> {
    for (const ownerId of leaving) {
      const remaining = this.store
        .list()
        .filter((t) => t.sharesWorkspaceOf === ownerId && !leaving.has(String(t.id)) && !isLeaving(t))
      const [heir, ...rest] = remaining
      if (!heir) continue
      await this.store.update(heir.id, { sharesWorkspaceOf: undefined })
      for (const sharer of rest) await this.store.update(sharer.id, { sharesWorkspaceOf: heir.id })
    }
  }

  /** Children of a deleted task keep running as children of its own parent (or top level). */
  private async promoteChildren(deleted: Task): Promise<void> {
    for (const child of this.store.list().filter((t) => t.parentTaskId === deleted.id)) {
      await this.store.update(child.id, { parentTaskId: deleted.parentTaskId })
    }
  }

  /** Locks taken in the order given (callers pass them sorted) so two multi-path holders can't deadlock. */
  private async withPathLocks<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
    const [first, ...rest] = keys
    if (first === undefined) return fn()
    return this.withPathLock(first, () => this.withPathLocks(rest, fn))
  }

  private async withPathLock<T>(key: string | null, fn: () => Promise<T>): Promise<T> {
    if (key === null) return fn()
    const previous = this.pathLocks.get(key) ?? Promise.resolve()
    let release!: () => void
    const turn = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => turn)
    this.pathLocks.set(key, tail)
    await previous
    try {
      return await fn()
    } finally {
      release()
      if (this.pathLocks.get(key) === tail) this.pathLocks.delete(key)
    }
  }
}
