/** Child-task contracts: spawning, migrating a tab into a child, and subtree deletion. */

import type { DaemonTask, TaskDispatcher, TaskPtyAlias, VendorId } from "./contracts.ts"

/** What `deleteTask` / `prepareTaskDeletion` accept. */
export interface TaskDeleteOptions {
  readonly force?: boolean
  readonly deleteBranch?: boolean
  /** Delete the whole subtree; default re-parents the task's children instead. */
  readonly cascade?: boolean
}

/** Input to `spawnChildTask` / `task.spawn`: a new conversation as a child of `parentTaskId`. */
export interface SpawnChildInput {
  readonly parentTaskId: string
  /** `true`: its own worktree cut from the parent's current branch tip; `false`: share the parent's directory. */
  readonly worktree: boolean
  /** Overrides the cut point of a new worktree. */
  readonly baseRef?: string
  /** Name of a symlink in the parent workspace: cut the worktree in the linked repo instead. */
  readonly isolateIn?: string
  readonly title?: string
  readonly vendor?: VendorId
  readonly command?: string
  /** The brief, kept on the row; delivery is the caller's. */
  readonly prompt?: string
  /** Create-time fields `add` carries onto the child as given (a shared child takes only the engine fields and `groupId`). */
  readonly modelEffort?: string
  readonly model?: string
  readonly tier?: string
  readonly groupId?: string
  readonly branch?: string
  readonly worktreeName?: string
  /** A worktree child's checkout waits for its first entry (`add`'s lazy worktree) instead of being cut during the call. */
  readonly lazy?: boolean
  readonly dispatcher?: TaskDispatcher
}

/** Result of `spawnChildTask` / `task.spawn`. */
export interface SpawnChildResult {
  readonly task: DaemonTask
  /** The parent's directory had uncommitted changes; a new worktree does not carry them. */
  readonly parentDirty: boolean
  /** Workspace-relative symlinks to outside git checkouts that this child does NOT isolate. */
  readonly sharedLinks: string[]
}

/** One extra engine conversation of a task, lifted into a shared child task (`createMigratedChild`). */
export interface MigratedChildInput {
  readonly parentTaskId: string
  readonly title: string
  /** The tab's own engine; neither field set = the child runs what its parent runs. */
  readonly vendor?: VendorId
  readonly command?: string
  /** The live hosted PTY `<taskId>::<tabId>` that already IS the conversation. */
  readonly ptyAlias?: TaskPtyAlias
}
