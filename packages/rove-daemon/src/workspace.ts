/**
 * Workspace backend ids and capabilities, pure over task rows. Lives in the
 * daemon package so the orchestrator, the daemon handlers and the CLI ask the
 * same question ("may Rove land / delete / checkpoint this?") instead of each
 * testing `task.kind`.
 */

export type WorkspaceBackendId = "git-worktree" | "borrowed" | "cow-clone" | "layerfs"

export const WORKSPACE_BACKEND_IDS: readonly WorkspaceBackendId[] = ["git-worktree", "borrowed", "cow-clone", "layerfs"]

export function isWorkspaceBackendId(value: unknown): value is WorkspaceBackendId {
  return typeof value === "string" && (WORKSPACE_BACKEND_IDS as readonly string[]).includes(value)
}

/** Which backend materialised a task's directory; `ref` is that backend's own handle. */
export interface TaskWorkspace {
  readonly backend: WorkspaceBackendId
  readonly ref?: string
}

export interface WorkspaceCapabilities {
  /** Does a fork carry the parent's uncommitted state? */
  readonly fork: "committed" | "with-uncommitted"
  /** Rove may snapshot and rewind the files (managed trees only). */
  readonly checkpoint: boolean
  readonly cheapClone: boolean
  /** Has a git branch Rove may land, rename and delete. */
  readonly ownsBranch: boolean
  /** Rove created the directory and may remove it. */
  readonly ownsDirectory: boolean
  /** Dev servers, simulators and host tools can reach the directory. */
  readonly interactive: boolean
}

const GIT_WORKTREE: WorkspaceCapabilities = {
  fork: "committed",
  checkpoint: true,
  cheapClone: false,
  ownsBranch: true,
  ownsDirectory: true,
  interactive: true,
}

export const WORKSPACE_CAPABILITIES: Readonly<Record<WorkspaceBackendId, WorkspaceCapabilities>> = {
  "git-worktree": GIT_WORKTREE,
  borrowed: {
    fork: "committed",
    checkpoint: false,
    cheapClone: false,
    ownsBranch: false,
    ownsDirectory: false,
    interactive: true,
  },
  "cow-clone": { ...GIT_WORKTREE, fork: "with-uncommitted", cheapClone: true },
  // Lives inside a Linux sandbox container: no host reach, and its git branch exists only there until exported.
  layerfs: { ...GIT_WORKTREE, cheapClone: true, ownsBranch: false, interactive: false },
}

type WorkspaceTask = { readonly kind?: "main" | "task" | "dir"; readonly workspace?: TaskWorkspace }

/** An explicit `workspace.backend` wins; rows without one derive it from `kind`. */
export function workspaceBackendId(task: WorkspaceTask): WorkspaceBackendId {
  if (task.workspace) return task.workspace.backend
  return task.kind === "main" || task.kind === "dir" ? "borrowed" : "git-worktree"
}

export function workspaceCapabilities(task: WorkspaceTask): WorkspaceCapabilities {
  return WORKSPACE_CAPABILITIES[workspaceBackendId(task)]
}
