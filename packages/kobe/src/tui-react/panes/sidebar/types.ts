/** Sidebar prop types. Values are plain `T`, never accessors: the host re-renders on change. */

import type { RowTokenMap, TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import type { TaskSortMode } from "../../../tui/panes/sidebar/groups"
import type { SidebarNav } from "../../../tui/panes/sidebar/nav-core"
import type { WorktreeChanges } from "../../../tui/panes/sidebar/worktree-changes"

/** Task-lifecycle callbacks shared VERBATIM by {@link SidebarProps}, the tree's
 *  bindings and menu, and the host, so the surfaces can't drift. */
export type SidebarTaskCallbacks = {
  onDeleteRequest?: (taskId: string) => void
  /** Row menu only: the Worktrees page's `l` land flow. */
  onLandRequest?: (taskId: string) => void
  /** Shift+M — lowercase `m` is captured but ignored (shift dropped on letters). */
  onLocalMergeRequest?: (taskId: string) => void
  /** Reorder mode: j/k move the cursor row at its LEVEL (tab, task, or a main row's project). */
  moveMode?: boolean
  onMoveRequest?: (taskId: string, delta: -1 | 1) => void
  onMoveModeExit?: () => void
  onRenameRequest?: (taskId: string) => void
  /** Shift+P only; a bare `p` binds nothing, so a mistype can't churn the pin flag. */
  onPinRequest?: (taskId: string) => void
  /** Set the task's board status. Menu-only, no chord. */
  onSetStatusRequest?: (taskId: string) => void
  /** Copy branch name or worktree path to the clipboard. Menu-only. */
  onCopyRequest?: (taskId: string, field: "branch" | "path") => void
  /** Re-fire `task.prompt` as a new task. Menu-only; hidden with no stored brief. */
  onRunAgainRequest?: (taskId: string) => void
  /** Menu route of `o`: open the task's worktree in the detected editor. */
  onOpenEditorRequest?: (taskId: string) => void
  /** Menu route of `b`: the branch picker/rename for the row's task. */
  onRenameBranchRequest?: (taskId: string) => void
  /** Menu route of `v`, as a picker rather than the chord's blind cycle. */
  onChangeEngineRequest?: (taskId: string) => void
  /** Pull failing CI job logs into the engine. Menu-only, while PR checks are red. */
  onFixChecksRequest?: (taskId: string) => void
  /** Merge the base branch into the worktree (the `↓N` chip's action). Menu-only. */
  onSyncBaseRequest?: (taskId: string) => void
  /** Project row's "Field notes": read the repo's durable notes. Menu-only. */
  onFieldNotesRequest?: (repo: string) => void
}

export type SidebarProps = SidebarTaskCallbacks & {
  /** Highlighted destination; owned by the workspace host, which swaps surfaces. */
  nav?: SidebarNav
  onNavChange?: (nav: SidebarNav) => void
  tasks: readonly Task[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Enter the row's task; fires on enter AND click (one `activateRow`). */
  onActivate?: (taskId: string) => void
  focused?: boolean
  /** Presence (non-undefined) turns on the sort toggle. */
  sortMode?: TaskSortMode
  /** Presence (non-undefined, null = "all") makes the filter host-controlled. */
  projectFilter?: string | null
  onSearchActiveChange?: (active: boolean) => void
  /** Optional width override; defaults to the sidebar rail width. */
  width?: number
  headerStatus?: { label: string; emphasize: boolean } | null
  onHeaderStatusClick?: () => void
  /** "newer version on npm" brand-row chip; null hides it. */
  updateChip?: { label: string } | null
  onUpdateChipClick?: () => void
  onAddTask?: () => void
  zenActive?: boolean
  onZenClick?: () => void
  engineState?: ReadonlyMap<string, TaskEngineState>
  /** Per-tab activity (taskId → tabId → state); the tree's tab rows use it. */
  engineTabState?: ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>
  /** Transient per-task lifecycle marks (subagent activity). */
  engineLifecycle?: ReadonlyMap<string, { readonly subagents: number }>
  taskJobs?: ReadonlyMap<string, TaskJobState>
  /** Plugin-written row labels, TTL-bounded (`task.tokens`). */
  rowTokens?: RowTokenMap
  worktreeChanges?: ReadonlyMap<string, WorktreeChanges | null> | null
}
