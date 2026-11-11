import { WORKSPACE_CAPABILITIES } from "@sma1lboy/rove-daemon/workspace"
import { forwardVerb, requireMachine } from "../../machines/forward.ts"
import { readRemoteWorkspace, removeRemoteLink } from "../../machines/remote-workspace.ts"
import type { DisposeTarget, WorkspaceBackend, WorkspaceHandle } from "./types.ts"

/**
 * A worktree on another machine, reached from a link directory here (`machines/remote-workspace.ts`).
 * `add --workspace-on` builds it; this backend is how a task's deletion reaches that machine.
 */
export class RemoteBackend implements WorkspaceBackend {
  readonly id = "remote"
  readonly capabilities = WORKSPACE_CAPABILITIES.remote

  async materialize(): Promise<WorkspaceHandle> {
    throw new Error("a remote workspace is created by `rove api add --workspace-on <machine>`")
  }

  /** The worktree's task there is deleted with the same force, so that machine's own dirty gate decides. */
  async dispose(target: DisposeTarget, opts: Parameters<WorkspaceBackend["dispose"]>[1]): Promise<void> {
    const ws = readRemoteWorkspace(target.path)
    if (ws) {
      const gone = await forwardVerb(requireMachine(ws.machine), "delete", {
        "task-id": ws.taskId,
        wait: true,
        ...(opts.force ? { force: true } : {}),
      })
      // A forced delete drops the link even when that machine cannot be asked; its worktree stays there.
      if (!gone.ok && gone.error.code !== "TASK_NOT_FOUND" && !opts.force) throw new Error(gone.error.message)
    }
    removeRemoteLink(target.path)
  }

  /** Nothing of the task is on this disk: the dirty gate is that machine's, asked at dispose. */
  async dirtyPaths(): Promise<readonly string[]> {
    return []
  }
}
