import { WORKSPACE_CAPABILITIES } from "@sma1lboy/rove-daemon/workspace"
import { repoWorkingDir } from "../core-helpers.ts"
import type { MaterializeSpec, WorkspaceBackend, WorkspaceHandle } from "./types.ts"

/** A directory the user already owns (`dir`): a project's own checkout or `rove .`. Nothing is created or removed. */
export class BorrowedBackend implements WorkspaceBackend {
  readonly id = "borrowed"
  readonly capabilities = WORKSPACE_CAPABILITIES.borrowed

  async materialize(spec: MaterializeSpec): Promise<WorkspaceHandle> {
    return { backend: this.id, path: spec.path ?? repoWorkingDir(spec.repo) }
  }

  async dispose(): Promise<void> {
    // Forgetting a borrowed workspace is dropping the index row; the directory is the user's.
  }
}
