import { errorMessage } from "../lib/error-message.ts"
import type { TaskId } from "../types/task.ts"
import { CannotDeleteMainTaskError, DirtyWorktreeError, WorktreeRemoveFailedError } from "./errors.ts"
import type { TaskIndexStore } from "./index/store.ts"
import type { WorktreeResidue } from "./worktree/manager-remove.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"
import type { IgnoredWorkProbe } from "./worktree/salvage-ignored.ts"
import type { SalvageRecord } from "./worktree/salvage.ts"

/** `deleteBranch` is never implied by `force`. */
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

  /** Persist acceptance after the destructive dirty-worktree safety check. */
  async prepare(id: TaskId | string, opts?: TaskDeletionOpts): Promise<boolean> {
    const task = this.store.get(id)
    if (!task) return false
    if (task.kind === "main") throw new CannotDeleteMainTaskError()
    if (task.deletion?.phase === "queued" || task.deletion?.phase === "running") return true

    const force = opts?.force === true
    // A `dir` task's directory is user-owned and never touched; only the index
    // entry goes, so no dirty gate.
    if (task.worktreePath && !force && task.kind !== "dir") {
      let dirty = false
      // Gitignored files aren't porcelain-dirty but don't survive removal
      // (`HANDOFF.md`, `.scratch/**`, `.env*` here). Porcelain alone let a
      // notes-only worktree delete with no force, confirm or salvage ref.
      let ignored: IgnoredWorkProbe = []
      let probed = true
      try {
        dirty = await this.worktrees.isDirty(task.worktreePath)
      } catch {
        // Missing/unreadable path: remove() resolves it. Skip the ignored
        // probe too — it would answer "unknown" for a hand-removed worktree
        // and block its deletion.
        probed = false
      }
      // Outside that catch, so a failed ignored listing stays "unknown" and
      // never reads as "nothing here".
      if (probed && !dirty) ignored = await this.worktrees.ignoredWork(task.worktreePath)
      if (dirty || ignored === "unknown" || ignored.length > 0) throw new DirtyWorktreeError(task.id, ignored)
    }

    await this.store.update(task.id, {
      deletion: {
        phase: "queued",
        force,
        // Never implied by `force`: the branch is git's durable record.
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
      // NEVER remove a `dir` task's directory (`kobe .`): it's the user's own.
      if (task.worktreePath && task.kind !== "dir") {
        await this.worktrees.remove(task.worktreePath, {
          force: task.deletion.force,
          deleteBranch: task.deletion.deleteBranch === true,
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
