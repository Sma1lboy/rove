export {
  WORKSPACE_CAPABILITIES,
  isWorkspaceBackendId,
  workspaceBackendId,
  workspaceCapabilities,
} from "@sma1lboy/rove-daemon/workspace"
export type { TaskWorkspace } from "@sma1lboy/rove-daemon/workspace"
export { BorrowedBackend } from "./borrowed.ts"
export { GitWorktreeBackend } from "./git-worktree.ts"
export { WorkspaceRegistry, createWorkspaceRegistry } from "./registry.ts"
export type {
  DisposeTarget,
  MaterializeSpec,
  WorkspaceBackend,
  WorkspaceBackendId,
  WorkspaceCapabilities,
  WorkspaceHandle,
} from "./types.ts"
