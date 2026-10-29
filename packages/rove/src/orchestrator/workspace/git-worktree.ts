import { WORKSPACE_CAPABILITIES } from "@sma1lboy/rove-daemon/workspace"
import type { GitWorktreeManager } from "../worktree/manager.ts"
import type { DisposeTarget, MaterializeSpec, WorkspaceBackend, WorkspaceHandle } from "./types.ts"

/** A linked `git worktree` under `~/.rove/worktrees`, with the main checkout's ignored dirs cloned in. */
export class GitWorktreeBackend implements WorkspaceBackend {
  readonly id = "git-worktree"
  readonly capabilities = WORKSPACE_CAPABILITIES["git-worktree"]

  constructor(protected readonly worktrees: GitWorktreeManager) {}

  async materialize(spec: MaterializeSpec): Promise<WorkspaceHandle> {
    const info = await this.worktrees.createForTask({
      repo: spec.repo,
      slug: spec.slug,
      branch: spec.branch,
      baseRef: spec.baseRef,
      onProgress: spec.onProgress,
    })
    return { backend: this.id, path: info.path }
  }

  async dispose(target: DisposeTarget, opts: Parameters<WorkspaceBackend["dispose"]>[1]): Promise<void> {
    // The repo and branch are what an already-vanished directory can no longer tell git.
    await this.worktrees.remove(target.path, { ...opts, repo: target.repo, branch: target.branch })
  }
}
