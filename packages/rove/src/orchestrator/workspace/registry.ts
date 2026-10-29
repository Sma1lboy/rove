import type { GitWorktreeManager } from "../worktree/manager.ts"
import { BorrowedBackend } from "./borrowed.ts"
import { GitWorktreeBackend } from "./git-worktree.ts"
import type { WorkspaceBackend, WorkspaceBackendId } from "./types.ts"

/** Backends by id. A task whose backend is not registered here (a newer daemon's) is an error, not a guess. */
export class WorkspaceRegistry {
  private readonly backends = new Map<WorkspaceBackendId, WorkspaceBackend>()

  constructor(backends: readonly WorkspaceBackend[]) {
    for (const backend of backends) this.backends.set(backend.id, backend)
  }

  get(id: WorkspaceBackendId): WorkspaceBackend {
    const backend = this.backends.get(id)
    if (!backend) throw new Error(`workspace backend '${id}' is not available in this build`)
    return backend
  }
}

export function createWorkspaceRegistry(worktrees: GitWorktreeManager): WorkspaceRegistry {
  return new WorkspaceRegistry([new GitWorktreeBackend(worktrees), new BorrowedBackend()])
}
