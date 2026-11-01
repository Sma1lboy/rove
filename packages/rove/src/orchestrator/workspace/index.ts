export {
  WORKSPACE_CAPABILITIES,
  isWorkspaceBackendId,
  workspaceBackendId,
  workspaceCapabilities,
} from "@sma1lboy/rove-daemon/workspace"
export type { TaskWorkspace } from "@sma1lboy/rove-daemon/workspace"
export { BorrowedBackend } from "./borrowed.ts"
export { type CloneEntries, type CloneProbe, type CowCloneDeps, CowCloneBackend } from "./cow-clone.ts"
export { GitWorktreeBackend } from "./git-worktree.ts"
export { LAYERFS_CONFIG_KEY, LayerfsBackend } from "./layerfs.ts"
export { WorkspaceRegistry, createWorkspaceRegistry } from "./registry.ts"
export type {
  DisposeTarget,
  MaterializeSpec,
  WorkspaceBackend,
  WorkspaceBackendId,
  WorkspaceCapabilities,
  WorkspaceCheckpointer,
  WorkspaceHandle,
} from "./types.ts"
