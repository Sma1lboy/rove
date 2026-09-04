/**
 * React sidebar prop types. Values are plain `T`, never accessors — the host
 * re-renders the Sidebar when one changes. Shared data shapes
 * (`WorktreeChanges`) come from the framework-free modules.
 */

import type { TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import type { TaskSortMode } from "../../../tui/panes/sidebar/groups"
import type { SidebarNav } from "../../../tui/panes/sidebar/nav-core"
import type { WorktreeChanges } from "../../../tui/panes/sidebar/worktree-changes"

/**
 * Task-lifecycle callbacks shared VERBATIM by {@link SidebarProps} (host
 * wiring) and `SidebarBindingsOpts` (the key controller in keys.ts) — one
 * definition so the two surfaces can't drift.
 */
export type SidebarTaskCallbacks = {
  onDeleteRequest?: (taskId: string) => void
  /** Row menu only — merge this task's branch into its base repo's current
   *  branch, the same flow as the Worktrees page's `l`. */
  onLandRequest?: (taskId: string) => void
  /** Shift+M — lowercase `m` is captured but ignored (shift dropped on letters). */
  onLocalMergeRequest?: (taskId: string) => void
  /** Scope-aware reorder mode: j/k move the cursor row's LEVEL
   *  — a tab within its task, a task within its repo group, a main row's
   *  whole project — instead of walking the cursor. */
  moveMode?: boolean
  onMoveRequest?: (taskId: string, delta: -1 | 1) => void
  onMoveModeExit?: () => void
  onRenameRequest?: (taskId: string) => void
  /**
   * Shift+P only. A bare `p` binds nothing — the registry row is an explicit
   * `shift+p` chord — so a mistyped press matches no binding and silently
   * does nothing rather than churning the pin flag (see the sidebar.pin row
   * in context/keybindings-sidebar.ts).
   */
  onPinRequest?: (taskId: string) => void
  /**
   * Set the task's board status. Menu-only for now — there is no chord, so
   * unlike its siblings this one never arrives from `use-tree-bindings`.
   */
  onSetStatusRequest?: (taskId: string) => void
  /**
   * Copy the task's branch name or worktree path to the system clipboard.
   * Menu-only, like `onSetStatusRequest` — no chord yet.
   */
  onCopyRequest?: (taskId: string, field: "branch" | "path") => void
  /**
   * Re-fire the task's stored brief (`task.prompt`) as a new task. Menu-only,
   * and the entry is withheld from a task with no stored brief.
   */
  onRunAgainRequest?: (taskId: string) => void
  /** Menu route of `o`: open the task's worktree in the detected editor. */
  onOpenEditorRequest?: (taskId: string) => void
  /** Menu route of `b`: the branch picker/rename for the row's task. */
  onRenameBranchRequest?: (taskId: string) => void
  /** Menu route of `v`, as a picker over the available engines rather than
   *  the chord's blind cycle. */
  onChangeEngineRequest?: (taskId: string) => void
  /**
   * Pull the row's failing CI job logs into its engine. Menu-only, and the
   * entry only exists while the row's PR checks are red.
   */
  onFixChecksRequest?: (taskId: string) => void
  /**
   * Merge the row's base branch into its worktree — the action behind the
   * `↓N` drift chip. Menu-only.
   */
  onSyncBaseRequest?: (taskId: string) => void
  /** Project row's "Field notes": read the repo's durable notes. Menu-only. */
  onFieldNotesRequest?: (repo: string) => void
}

export type SidebarProps = SidebarTaskCallbacks & {
  /** Which top-level destination the rail highlights. Owned by the workspace
   *  host — it is the thing that actually swaps surfaces. */
  nav?: SidebarNav
  onNavChange?: (nav: SidebarNav) => void
  tasks: readonly Task[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Fires on keyboard enter, and optionally mouse click in the Tasks pane. */
  onActivate?: (taskId: string) => void
  /** Task pane opts in because click-to-switch is cheap there. */
  activateOnClick?: boolean
  /** Keep a task-bound pane visually pinned to its own task after jump-away. */
  pinnedSelection?: boolean
  focused?: boolean
  /** Presence (non-undefined) turns on the sort toggle. */
  sortMode?: TaskSortMode
  /** Presence (non-undefined, null = "all") makes the filter host-controlled. */
  projectFilter?: string | null
  onProjectFilterChange?: (repo: string | null) => void
  onSearchActiveChange?: (active: boolean) => void
  onCursorChange?: (taskId: string | null) => void
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
  worktreeChanges?: ReadonlyMap<string, WorktreeChanges> | null
  /** Daemon-collected transcript facts keyed by WORKTREE path — proves a
   * "complete" turn whose engine is still writing (hook-silent phases). */
  transcriptActivity?: ReadonlyMap<string, { readonly mtimeMs: number }> | null
}
