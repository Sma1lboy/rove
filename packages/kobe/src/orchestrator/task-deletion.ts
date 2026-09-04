import { errorMessage } from "../lib/error-message.ts"
import type { TaskId } from "../types/task.ts"
import { CannotDeleteMainTaskError, DirtyWorktreeError, WorktreeRemoveFailedError } from "./errors.ts"
import type { TaskIndexStore } from "./index/store.ts"
import type { WorktreeResidue } from "./worktree/manager-remove.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"
import type { SalvageRecord } from "./worktree/salvage.ts"

/** Caller options for a task deletion. `deleteBranch` is a separate opt-in,
 *  never implied by `force`. */
export interface TaskDeletionOpts {
  readonly force?: boolean
  readonly deleteBranch?: boolean
}

/**
 * Persistent task-deletion state machine. The daemon owns scheduling; this
 * collaborator owns safety checks and the atomic task-index transitions.
 */
export class TaskDeletionCoordinator {
  constructor(
    private readonly store: TaskIndexStore,
    private readonly worktrees: GitWorktreeManager,
    private readonly forgetTask: (id: TaskId) => void,
    /**
     * Notified when a forced removal salvaged uncommitted work. The daemon
     * wires this to the deletion audit log so the recovery ref lands beside
     * the `removed` line — a user who just lost a tab has the task title and
     * roughly the time, and that is what the audit trail is indexed by.
     */
    private readonly onSalvage?: (taskId: TaskId, record: SalvageRecord) => void,
    /**
     * Notified when git deregistered the worktree but could not delete its
     * directory. Wired to the deletion audit log for the same reason
     * `onSalvage` is: the deletion itself SUCCEEDS (see `finish`), so this is
     * the only record that a directory is still on disk.
     */
    private readonly onResidue?: (taskId: TaskId, residue: WorktreeResidue) => void,
  ) {}

  /** Persist acceptance after the destructive dirty-worktree safety check. */
  async prepare(id: TaskId | string, opts?: TaskDeletionOpts): Promise<boolean> {
    const task = this.store.get(id)
    if (!task) return false
    if (task.kind === "main") throw new CannotDeleteMainTaskError()
    if (task.deletion?.phase === "queued" || task.deletion?.phase === "running") return true

    const force = opts?.force === true
    // A `dir` task pins a user-owned directory that deletion never touches,
    // so the dirty-worktree gate (a prompt about work that would be lost)
    // doesn't apply — only the index entry goes away.
    if (task.worktreePath && !force && task.kind !== "dir") {
      let dirty = false
      // Work `status --porcelain` cannot see. `.gitignore`d files survive a
      // land and a sync, so they are not "dirty" — but they do NOT survive a
      // worktree removal, and `HANDOFF.md` / `.scratch/**` / `.env*` are
      // gitignored in this very repo. Gating on the porcelain alone let a
      // worktree whose only work was a session's notes delete with no force,
      // no confirm, and no salvage ref.
      let ignored: readonly string[] = []
      try {
        dirty = await this.worktrees.isDirty(task.worktreePath)
        if (!dirty) ignored = await this.worktrees.ignoredWork(task.worktreePath)
      } catch {
        // A missing/unreadable path is resolved by remove(), as before.
      }
      if (dirty || ignored.length > 0) throw new DirtyWorktreeError(task.id, ignored)
    }

    await this.store.update(task.id, {
      deletion: {
        phase: "queued",
        force,
        // Branch deletion is a separate opt-in, never implied by `force`:
        // deleting a task drops the worktree + index entry; the branch is
        // git's durable record and survives unless explicitly requested.
        deleteBranch: opts?.deleteBranch === true,
        requestedAt: new Date().toISOString(),
      },
    })
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
    try {
      // NEVER remove a `dir` task's directory: it is the user's own
      // directory (`kobe .`), not a kobe-managed worktree. Deleting the
      // task must only drop the index entry.
      if (task.worktreePath && task.kind !== "dir") {
        await this.worktrees.remove(task.worktreePath, {
          force: task.deletion.force,
          deleteBranch: task.deletion.deleteBranch === true,
          // The owning repo, for the case where the worktree DIRECTORY is
          // already gone: its stale admin record can only be pruned from
          // here, and with the directory missing nothing on disk still points
          // back at the repo. A task has always known this; it just never
          // passed it down, so the prune silently never ran.
          repo: task.repo,
          // `force` was frozen at prepare() time and this runs on a later
          // tick — possibly in a later daemon process (`resume()` replays a
          // queued deletion after a restart), so the worktree may have gone
          // dirty since the check that authorised the force. Re-evaluating
          // the gate here would be a behavior change (a delete the user
          // already confirmed would start failing); salvaging instead keeps
          // the delete as asked and makes the loss recoverable.
          onSalvage: (record) => {
            if (record) this.onSalvage?.(task.id, record)
          },
          // A removal git half-completed (metadata deregistered, directory
          // undeletable) is NOT an error here. Parking the task in `error`
          // would be a lie the user cannot act on: git has forgotten this
          // worktree, so every retry is `fatal: is not a working tree` and the
          // task is stuck forever. The deletion finishes; the
          // leftover directory is reported instead of being made the task's
          // problem — and never deleted from under the user, since whatever
          // made it undeletable may be something they want.
          onResidue: (residue) => this.onResidue?.(task.id, residue),
        })
      }
    } catch (cause) {
      const failure = new WorktreeRemoveFailedError(task.id, cause)
      await this.store.update(task.id, {
        deletion: {
          ...task.deletion,
          phase: "error",
          error: errorMessage(failure),
        },
      })
      throw failure
    }
    await this.store.remove(task.id)
    this.forgetTask(task.id)
  }

  /** Compatibility path for local callers that still require completion. */
  async deleteNow(id: TaskId | string, opts?: TaskDeletionOpts): Promise<void> {
    if (!(await this.prepare(id, opts))) return
    if (!(await this.begin(id))) return
    await this.finish(id)
  }
}
