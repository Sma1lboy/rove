/**
 * React sidebar prop types (issue #15, G3). Ported from the Solid-era props
 * (removed 2026-07-07) with the idiomatic React translation: every
 * `Accessor<T>` prop became a plain `T` — the host re-renders the Sidebar
 * when the value changes, so per-read reactivity has no equivalent.
 * Callback props are unchanged. Shared data shapes (`WorktreeChanges`) are
 * the framework-free originals.
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
  /** Shift+M — lowercase `m` is captured but ignored (shift dropped on letters). */
  onLocalMergeRequest?: (taskId: string) => void
  /** Scope-aware reorder mode (issue #43): j/k move the cursor row's LEVEL
   *  — a tab within its task, a task within its repo group, a main row's
   *  whole project — instead of walking the cursor. */
  moveMode?: boolean
  onMoveRequest?: (taskId: string, delta: -1 | 1) => void
  onMoveModeExit?: () => void
  onRenameRequest?: (taskId: string) => void
  /**
   * Shift+P only. A bare `p` binds nothing — the registry row is an explicit
   * `shift+p` chord — so a mistyped press matches no binding and silently
   * does nothing rather than churning the pin flag (same contract as the
   * Solid era; see the sidebar.pin row in context/keybindings-sidebar.ts).
   */
  onPinRequest?: (taskId: string) => void
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
  /** Presence (non-undefined) turns on the sort toggle, like the Solid accessor. */
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
