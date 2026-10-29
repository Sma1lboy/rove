/**
 * Which task a checkpoint belongs to, and the gate in front of the git side
 * (`worktree/checkpoint.ts`). Checkpoints belong to the WORKSPACE OWNER: a
 * child that shares its parent's directory follows its owner, as
 * `Orchestrator.ensureWorktree` does.
 */

import type { CheckpointOrchestrator } from "@sma1lboy/rove-daemon/daemon/checkpoint-contracts"
import type { Task, TaskId } from "../types/task.ts"
import type { TaskIndexStore } from "./index/store.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"

export class WorkspaceCheckpoints implements CheckpointOrchestrator {
  constructor(
    private readonly store: Pick<TaskIndexStore, "get" | "list">,
    private readonly worktrees: Pick<
      GitWorktreeManager,
      "pathExists" | "takeCheckpoint" | "listCheckpoints" | "rewindToCheckpoint"
    >,
    private readonly requireTask: (id: TaskId | string) => Task,
  ) {}

  /** The row that owns `id`'s workspace: a sharer follows its owner; everything else owns its own. */
  private workspaceOwner(id: TaskId | string): Task {
    const task = this.requireTask(id)
    return (task.sharesWorkspaceOf ? this.store.get(task.sharesWorkspaceOf) : undefined) ?? task
  }

  /** `sharerIds` is every live task in the workspace (owner first) — the set whose engines a rewind must not race. */
  checkpointScope(id: TaskId | string): { ownerId: string; sharerIds: string[] } {
    const owner = this.workspaceOwner(id)
    const sharers = this.store.list().filter((t) => t.sharesWorkspaceOf === owner.id && !t.deletion)
    return { ownerId: String(owner.id), sharerIds: [String(owner.id), ...sharers.map((t) => String(t.id))] }
  }

  /**
   * Managed workspaces only (owner of kind `task`): a main/dir tree is the
   * user's own. Replaced by the workspace-capabilities check when that lands.
   */
  canCheckpoint(id: TaskId | string): boolean {
    if (!this.store.get(id)) return false
    const owner = this.workspaceOwner(id)
    return owner.kind === "task" && !owner.deletion && owner.worktreePath !== ""
  }

  /** The owner's id and worktree `canCheckpoint` allows, or a `NOT_CHECKPOINTABLE:` error naming why not. */
  private async target(id: TaskId | string): Promise<{ ownerId: string; dir: string }> {
    const owner = this.workspaceOwner(id)
    // A managed worktree always has a `.git` entry (file); its absence means a dead or non-git directory.
    if (!this.canCheckpoint(id) || !(await this.worktrees.pathExists(`${owner.worktreePath}/.git`))) {
      throw new Error(
        `NOT_CHECKPOINTABLE: ${owner.kind === "task" ? "the task has no git worktree on disk" : `a ${owner.kind} task works in your own checkout`}`,
      )
    }
    return { ownerId: String(owner.id), dir: owner.worktreePath }
  }

  async takeCheckpoint(id: TaskId | string, opts?: { tabId?: string }) {
    const { ownerId, dir } = await this.target(id)
    return this.worktrees.takeCheckpoint(dir, ownerId, opts)
  }

  async listCheckpoints(id: TaskId | string) {
    const { ownerId, dir } = await this.target(id)
    return this.worktrees.listCheckpoints(dir, ownerId)
  }

  async rewindToCheckpoint(id: TaskId | string, n: number) {
    const { ownerId, dir } = await this.target(id)
    return this.worktrees.rewindToCheckpoint(dir, ownerId, n)
  }
}
