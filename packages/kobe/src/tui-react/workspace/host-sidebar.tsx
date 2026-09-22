/** @jsxImportSource @opentui/react */
/**
 * The host's left rail: which sidebar renders, and its wiring. A new sidebar
 * concern lands here, not on the host. Task-lifecycle callbacks come from
 * {@link SidebarTaskCallbacks}, all REQUIRED except `onLandRequest`.
 */

import type { RowTokenMap, TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { type MutableRefObject, useCallback } from "react"
import type { TaskSortMode } from "../../tui/panes/sidebar/groups"
import type { SidebarNav } from "../../tui/panes/sidebar/nav-core"
import type { WorktreeChanges } from "../../tui/panes/sidebar/worktree-changes"
import { PaneKeyHint } from "../component/keyboard-hints"
import { useKV, useOptionalKV } from "../context/kv"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { SidebarTree } from "../panes/sidebar/SidebarTree"
import { CollapsedRail, type CollapsedRailStyle, DEFAULT_COLLAPSED_RAIL_STYLE } from "../panes/sidebar/collapsed-rail"
import type { SidebarTaskCallbacks } from "../panes/sidebar/types"
import { useSidebarGroups } from "../panes/sidebar/use-sidebar-groups"
import { closeTaskTab } from "./terminal-tabs-close"
import { moveTaskTab } from "./terminal-tabs-move"
import { requestNewTab } from "./terminal-tabs-shared"

export interface HostSidebarProps
  extends Readonly<Required<Omit<SidebarTaskCallbacks, "onLandRequest">>>,
    Readonly<Pick<SidebarTaskCallbacks, "onLandRequest">> {
  readonly width: number
  readonly collapsed?: boolean
  /** Fold / unfold. Absent = the rail renders without the control. */
  readonly onToggleCollapsed?: () => void
  /** Which fold the strip renders; defaults to the jump digits. */
  readonly collapsedStyle?: CollapsedRailStyle
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
  readonly rowTokens?: RowTokenMap
  readonly worktreeChanges?: ReadonlyMap<string, WorktreeChanges | null> | null
  readonly onAddTask: () => void
  readonly onSearchActiveChange: (active: boolean) => void
  readonly headerStatus: { label: string; emphasize: boolean }
  readonly onHeaderStatusClick: () => void
  /** "newer version on npm" chip beside the brand text; null hides it. */
  readonly updateChip?: { label: string } | null
  readonly onUpdateChipClick?: () => void
  readonly zenActive: boolean
  readonly onZenClick: () => void
  readonly onFocusRequest: () => void
  /** Narrow mode's "↩ recent" jump row target. */
  readonly recentTask?: Task | null
  /** Global task sort mode driven by the `t` chord. */
  readonly sortMode?: TaskSortMode
  /** Reader of the task under the tree cursor — see `SidebarTreeProps`. */
  readonly cursorTaskIdRef?: MutableRefObject<() => string | null>
}

export function HostSidebar(props: HostSidebarProps) {
  const { onFocusRequest: _rail, recentTask: _recent, ...treeProps } = props
  const { theme } = useTheme()
  const kv = useKV()
  const notif = useNotifications()
  const t = useT()
  // Who owns a tab's state depends on whether its TerminalTabs is mounted;
  // `closeTaskTab` holds that fork. Closing the LAST tab is fine (revived on
  // re-entry); false means a stale row, surfaced as a toast.
  const closeTab = useCallback(
    (taskId: string, tabId: string): void => {
      if (!closeTaskTab(kv, taskId, tabId))
        notif.notify({ kind: "error", taskId, tabId, title: t("terminal.tab.tabGone") })
    },
    [kv, notif, t],
  )
  // Same mounted-vs-background fork (`moveTaskTab`); an edge-stop is a silent no-op.
  const moveTab = useCallback(
    (taskId: string, tabId: string, delta: -1 | 1): void => {
      moveTaskTab(kv, taskId, tabId, delta)
    },
    [kv],
  )
  // No background path: the picker is a dialog and a shell tab needs its PTY
  // where tabs render, so ENTER the task; its workspace claims the request.
  const newTab = useCallback(
    (taskId: string, kind: "chat" | "shell"): void => {
      props.onActivate(taskId)
      requestNewTab(taskId, kind)
    },
    [props.onActivate],
  )
  if (props.collapsed) {
    return (
      <CollapsedSidebar
        style={props.collapsedStyle ?? DEFAULT_COLLAPSED_RAIL_STYLE}
        tasks={props.tasks}
        sortMode={props.sortMode}
        selectedId={props.selectedId}
        engineState={props.engineState}
        taskJobs={props.taskJobs}
        onSelect={props.onSelect}
        onActivate={props.onActivate}
        onExpand={() => props.onToggleCollapsed?.()}
      />
    )
  }
  return (
    <box
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={theme.backgroundPanel}
      onMouseUp={props.onFocusRequest}
    >
      {/* HostSidebarProps is SidebarTreeProps plus the rail's own two props,
          so the tree takes the rest wholesale rather than a re-listing of
          thirty names that can silently fall out of date. */}
      <SidebarTree
        {...treeProps}
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

/** The folded rail. Its own component so the `useSidebarGroups` hook runs
 *  only on this side of the fold's early return. */
function CollapsedSidebar(props: {
  readonly style: CollapsedRailStyle
  readonly tasks: readonly Task[]
  readonly sortMode?: TaskSortMode
  readonly selectedId: string | null
  readonly engineState?: ReadonlyMap<string, TaskEngineState>
  readonly taskJobs?: ReadonlyMap<string, TaskJobState>
  readonly onSelect: (taskId: string) => void
  readonly onActivate: (taskId: string) => void
  readonly onExpand: () => void
}) {
  // No KV provider: tabs unknown, which the hide rules read as "never mounted".
  const kv = useOptionalKV()
  const { groups } = useSidebarGroups({
    tasks: props.tasks,
    kv,
    sortMode: props.sortMode,
    engineState: props.engineState,
  })
  return (
    <CollapsedRail
      style={props.style}
      groups={groups}
      selectedId={props.selectedId}
      engineState={props.engineState}
      taskJobs={props.taskJobs}
      onSelect={props.onSelect}
      onActivate={props.onActivate}
      onExpand={props.onExpand}
    />
  )
}
