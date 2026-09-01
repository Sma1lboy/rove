/** @jsxImportSource @opentui/react */
/**
 * The workspace host's left rail — which sidebar renders, and its wiring.
 *
 * Its own component because `host.tsx` should compose the workspace, not know
 * how one rail is wired. The ~30 props below are that wiring made explicit —
 * having to pass them is the honest cost of the boundary, and it is why a new
 * sidebar concern lands here instead of accreting on the host.
 */

import type { TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { useCallback } from "react"
import type { TaskSortMode } from "../../tui/panes/sidebar/groups"
import type { SidebarNav } from "../../tui/panes/sidebar/nav-core"
import type { WorktreeChanges } from "../../tui/panes/sidebar/worktree-changes"
import { PaneKeyHint } from "../component/keyboard-hints"
import { useKV } from "../context/kv"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { SidebarTree } from "../panes/sidebar/SidebarTree"
import { closeTaskTab } from "./terminal-tabs-close"
import { moveTaskTab } from "./terminal-tabs-move"
import { requestNewTab } from "./terminal-tabs-shared"

export interface HostSidebarProps {
  readonly width: number
  readonly nav: SidebarNav
  readonly onNavChange: (nav: SidebarNav) => void
  readonly tasks: readonly Task[]
  readonly selectedId: string | null
  readonly selectedTabId: string | null
  readonly onSelect: (taskId: string) => void
  readonly onActivate: (taskId: string) => void
  readonly onSelectTab: (taskId: string, tabId: string) => void
  readonly focused: boolean
  readonly engineState?: ReadonlyMap<string, TaskEngineState>
  /** Per-tab activity, keyed taskId → tabId. The tree lights the exact tab. */
  readonly engineTabState?: ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>
  readonly engineLifecycle?: ReadonlyMap<string, { readonly subagents: number }>
  readonly taskJobs?: ReadonlyMap<string, TaskJobState>
  readonly worktreeChanges?: ReadonlyMap<string, WorktreeChanges> | null
  readonly transcriptActivity?: ReadonlyMap<string, { readonly mtimeMs: number }> | null
  readonly onAddTask: () => void
  readonly onDeleteRequest: (taskId: string) => void
  readonly onRenameRequest: (taskId: string) => void
  readonly onPinRequest: (taskId: string) => void
  readonly moveMode: boolean
  readonly onMoveRequest: (taskId: string, delta: -1 | 1) => void
  readonly onMoveModeExit: () => void
  readonly onLocalMergeRequest: (taskId: string) => void
  readonly onSearchActiveChange: (active: boolean) => void
  readonly headerStatus: { label: string; emphasize: boolean }
  readonly onHeaderStatusClick: () => void
  /** "newer version on npm" chip beside the brand text; null hides it. */
  readonly updateChip?: { label: string } | null
  readonly onUpdateChipClick?: () => void
  readonly zenActive: boolean
  readonly onZenClick: () => void
  readonly onFocusRequest: () => void
  /** Narrow mode's "↩ recent" jump row target (issue #14, 2A). */
  readonly recentTask?: Task | null
  /** Global task sort mode driven by the `t` chord. */
  readonly sortMode?: TaskSortMode
}

export function HostSidebar(props: HostSidebarProps) {
  const { theme } = useTheme()
  const kv = useKV()
  const notif = useNotifications()
  const t = useT()
  // Tab close is the one sidebar action the host can't express as a task-level
  // callback: the tree names a tab of ANY worktree, so who owns that tab's
  // state depends on whether its TerminalTabs is mounted. `closeTaskTab` is
  // where that fork lives; a failure surfaces as a toast rather than a silent
  // no-op. Closing the LAST tab is not a failure (it empties the list and the
  // row is revived on re-entry), so the only false left is a tab the tree
  // still lists but the state no longer has — a stale row, not a refusal.
  const closeTab = useCallback(
    (taskId: string, tabId: string): void => {
      if (!closeTaskTab(kv, taskId, tabId))
        notif.notify({ kind: "error", taskId, tabId, title: t("terminal.tab.tabGone") })
    },
    [kv, notif, t],
  )
  // Tab reorder is tab close's sibling (move mode on a tab row, issue #43):
  // same mounted-vs-background fork, same "who owns this task's state"
  // question — `moveTaskTab` is where that fork lives. An edge-stop (first
  // tab up / last down) is a silent no-op, not an error.
  const moveTab = useCallback(
    (taskId: string, tabId: string, delta: -1 | 1): void => {
      moveTaskTab(kv, taskId, tabId, delta)
    },
    [kv],
  )
  // "New conversation" / "New shell" from a row's menu (owner ask
  // 2026-08-18). Unlike close/move there is no background path: the picker is
  // a dialog and a shell tab needs its PTY where the tabs render, so this
  // ENTERS the task first and the request is claimed by its workspace — on
  // the spot when it is already mounted, on first mount otherwise.
  const newTab = useCallback(
    (taskId: string, kind: "chat" | "shell"): void => {
      props.onActivate(taskId)
      requestNewTab(taskId, kind)
    },
    [props.onActivate],
  )
  const common = {
    width: props.width,
    nav: props.nav,
    onNavChange: props.onNavChange,
    tasks: props.tasks,
    selectedId: props.selectedId,
    onSelect: props.onSelect,
    onActivate: props.onActivate,
    engineState: props.engineState,
    engineTabState: props.engineTabState,
    engineLifecycle: props.engineLifecycle,
    taskJobs: props.taskJobs,
    worktreeChanges: props.worktreeChanges,
    transcriptActivity: props.transcriptActivity,
    focused: props.focused,
    onDeleteRequest: props.onDeleteRequest,
    onRenameRequest: props.onRenameRequest,
    onPinRequest: props.onPinRequest,
    onLocalMergeRequest: props.onLocalMergeRequest,
    moveMode: props.moveMode,
    onMoveRequest: props.onMoveRequest,
    onMoveModeExit: props.onMoveModeExit,
    onSearchActiveChange: props.onSearchActiveChange,
    onAddTask: props.onAddTask,
    headerStatus: props.headerStatus,
    onHeaderStatusClick: props.onHeaderStatusClick,
    updateChip: props.updateChip,
    onUpdateChipClick: props.onUpdateChipClick,
    zenActive: props.zenActive,
    onZenClick: props.onZenClick,
    sortMode: props.sortMode,
  }
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={theme.backgroundPanel}
      onMouseUp={props.onFocusRequest}
    >
      <SidebarTree
        {...common}
        selectedTabId={props.selectedTabId}
        onSelectTab={props.onSelectTab}
        onCloseTab={closeTab}
        onNewTab={newTab}
        onMoveTabRequest={moveTab}
        recentTask={props.recentTask ?? null}
      />
      {/* First-use key hint (component/keyboard-hints.tsx): renders until
          the sidebar's own keys have been used, then never again. */}
      <box flexShrink={0} paddingLeft={1} paddingBottom={0}>
        <PaneKeyHint pane="sidebar" />
      </box>
    </box>
  )
}
