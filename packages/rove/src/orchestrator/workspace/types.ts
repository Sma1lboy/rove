/**
 * The seam between the task lifecycle and whatever puts a task's files on
 * disk. Neutral code asks a backend for its {@link WorkspaceCapabilities} and
 * never tests a backend id. Every backend materialises a stable, absolute,
 * local path (docs/design/workspace-runner.md, "the one invariant").
 */

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

export interface WorkspaceBackend {
  readonly id: WorkspaceBackendId
  readonly capabilities: WorkspaceCapabilities
  materialize(spec: MaterializeSpec): Promise<WorkspaceHandle>
  /** Take the workspace down. `borrowed` forgets; the others refuse dirty work unless `force`. */
  dispose(target: DisposeTarget, opts: Omit<RemoveOpts, "repo" | "branch">): Promise<void>
}
