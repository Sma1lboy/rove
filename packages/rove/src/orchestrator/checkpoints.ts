/**
 * Which task a checkpoint belongs to, and the gate in front of the git side
 * (`worktree/checkpoint.ts`). Checkpoints belong to the WORKSPACE OWNER: a
 * child that shares its parent's directory follows its owner, as
 * `Orchestrator.ensureWorktree` does.
 */

import type { CheckpointOrchestrator } from "@sma1lboy/rove-daemon/daemon/checkpoint-contracts"
import { workspaceBackendId, workspaceCapabilities } from "@sma1lboy/rove-daemon/workspace"
import type { Task, TaskId } from "../types/task.ts"
import type { TaskIndexStore } from "./index/store.ts"
import type { WorkspaceCheckpointer, WorkspaceRegistry } from "./workspace/index.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"

export class WorkspaceCheckpoints implements CheckpointOrchestrator {
  constructor(
    private readonly store: Pick<TaskIndexStore, "get" | "list">,
    private readonly worktrees: Pick<
      GitWorktreeManager,
      "pathExists" | "takeCheckpoint" | "listCheckpoints" | "rewindToCheckpoint"
    >,
    private readonly workspaces: Pick<WorkspaceRegistry, "get">,
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

  /** The owner's backend must declare the `checkpoint` capability: a borrowed tree is the user's own. */
  canCheckpoint(id: TaskId | string): boolean {
    if (!this.store.get(id)) return false
    const owner = this.workspaceOwner(id)
    return workspaceCapabilities(owner).checkpoint && !owner.deletion && owner.worktreePath !== ""
  }

  /**
   * The owner's id, worktree and whoever snapshots it (the backend's own checkpointer, else git refs), or a
   * `NOT_CHECKPOINTABLE:` error naming why not.
   */
  private async target(id: TaskId | string): Promise<{ ownerId: string; dir: string; via: WorkspaceCheckpointer }> {
    const owner = this.workspaceOwner(id)
    const own = this.canCheckpoint(id) ? this.workspaces.get(workspaceBackendId(owner)).checkpoints : undefined
    const dir = owner.worktreePath
    // A managed worktree always has a `.git` entry (file); its absence means a dead or non-git directory.
    if (!this.canCheckpoint(id) || !(await this.worktrees.pathExists(own ? dir : `${dir}/.git`))) {
      throw new Error(
        `NOT_CHECKPOINTABLE: ${owner.kind === "task" ? "the task has no workspace on disk" : `a ${owner.kind} task works in your own checkout`}`,
      )
    }
    const ownerId = String(owner.id)
    const via: WorkspaceCheckpointer = own ?? {
      take: (d, opts) => this.worktrees.takeCheckpoint(d, ownerId, opts),
      list: (d) => this.worktrees.listCheckpoints(d, ownerId),
      rewind: (d, n) => this.worktrees.rewindToCheckpoint(d, ownerId, n),
    }
    return { ownerId, dir, via }
  }

  async takeCheckpoint(id: TaskId | string, opts?: { tabId?: string }) {
    const { dir, via } = await this.target(id)
    return via.take(dir, opts)
  }

  async listCheckpoints(id: TaskId | string) {
    const { dir, via } = await this.target(id)
    return via.list(dir)
  }

  async rewindToCheckpoint(id: TaskId | string, n: number) {
    const { dir, via } = await this.target(id)
    return via.rewind(dir, n)
  }

  async exportBranch(id: TaskId | string): Promise<{ branch: string; commit: string }> {
    const owner = this.workspaceOwner(id)
    const backend = this.workspaces.get(workspaceBackendId(owner))
    if (!backend.exportBranch || !owner.worktreePath) {
      throw new Error("EXPORT_UNSUPPORTED: the task's branch is already in its repo (or it has no workspace yet)")
    }
    return backend.exportBranch({ path: owner.worktreePath, repo: owner.repo, branch: owner.branch })
  }
}
