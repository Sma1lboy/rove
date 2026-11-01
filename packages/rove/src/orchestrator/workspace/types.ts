/**
 * The seam between the task lifecycle and whatever puts a task's files on
 * disk. Neutral code asks a backend for its {@link WorkspaceCapabilities} and
 * never tests a backend id. Every backend materialises a stable, absolute,
 * local path (docs/design/workspace-runner.md, "the one invariant").
 */

import type {
  CheckpointRecord,
  RewindResult,
  TakeCheckpointResult,
} from "@sma1lboy/rove-daemon/daemon/checkpoint-contracts"
import type { WorkspaceBackendId, WorkspaceCapabilities } from "@sma1lboy/rove-daemon/workspace"
import type { RemoveOpts } from "../worktree/manager-remove.ts"

export type { WorkspaceBackendId, WorkspaceCapabilities }

/** What {@link WorkspaceBackend.materialize} is asked for. Fields a backend has no use for are ignored. */
export interface MaterializeSpec {
  readonly repo: string
  /** Directory basename picked by the slug allocator. */
  readonly slug: string
  readonly branch: string
  readonly baseRef?: string
  readonly onProgress?: (percent: number) => void
  /** An existing directory to use as-is (`borrowed`); absent = the repo's own checkout. */
  readonly path?: string
  /** Absolute path of the worktree to clone (`cow-clone`); absent = a plain worktree. */
  readonly forkFrom?: string
}

/** A materialised workspace: the path every consumer keys on, and the backend's own handle. */
export interface WorkspaceHandle {
  readonly backend: WorkspaceBackendId
  readonly path: string
  readonly ref?: string
}

/** The directory (and branch) of a workspace being disposed, as the task row records them. */
export interface DisposeTarget {
  readonly path: string
  /** Known when the caller has it; load-bearing only once the directory is gone. */
  readonly repo?: string
  readonly branch?: string
}

/** A backend that snapshots its own storage instead of the git-ref checkpoints in `worktree/checkpoint.ts`. */
export interface WorkspaceCheckpointer {
  take(path: string, opts?: { tabId?: string }): Promise<TakeCheckpointResult>
  list(path: string): Promise<CheckpointRecord[]>
  rewind(path: string, n: number): Promise<RewindResult>
}

/**
 * A backend whose files live inside a container keeps a host directory at `WorkspaceHandle.path` holding the PTY
 * launch prefix (`LAUNCH_PREFIX_FILE`), so every terminal opened there runs inside the container at the same path.
 */
export interface WorkspaceBackend {
  readonly id: WorkspaceBackendId
  readonly capabilities: WorkspaceCapabilities
  /** Throws when this backend cannot run here; called before a task row naming it is created. */
  preflight?(): Promise<void>
  materialize(spec: MaterializeSpec): Promise<WorkspaceHandle>
  /** Take the workspace down. `borrowed` forgets; the others refuse dirty work unless `force`. */
  dispose(target: DisposeTarget, opts: Omit<RemoveOpts, "repo" | "branch">): Promise<void>
  /** Uncommitted work a removal would lose, for a backend git cannot see into; absent = git status of the path. */
  dirtyPaths?(path: string): Promise<readonly string[]>
  readonly checkpoints?: WorkspaceCheckpointer
  /** Copy the workspace's git branch into the host repo, for a backend whose branch lives elsewhere. */
  exportBranch?(target: DisposeTarget & { repo: string; branch: string }): Promise<{ branch: string; commit: string }>
}
