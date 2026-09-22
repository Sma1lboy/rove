/** @jsxImportSource @opentui/react */
/**
 * The host's sidebar MOUNT: adapts the host's hook bundles to `HostSidebar`'s
 * props; every "what does clicking a row mean" decision lives here. Props are
 * the BUNDLES, not spread fields, which would re-introduce the drift
 * `SidebarTaskCallbacks` prevents.
 */

import type { Task } from "@/types/task"
import type { MutableRefObject } from "react"
import { RAIL_FOLD_STYLE_KEY } from "../../state/sidebar-collapsed.ts"
import type { TaskSortMode } from "../../tui/panes/sidebar/groups"
import type { FocusContextValue } from "../context/focus"
import { useKV } from "../context/kv"
import {
  COLLAPSED_RAIL_STYLES,
  type CollapsedRailStyle,
  DEFAULT_COLLAPSED_RAIL_STYLE,
} from "../panes/sidebar/collapsed-rail"
import type { HostPagesState } from "./host-pages"
import { HostSidebar } from "./host-sidebar"
import type { WorkspaceTaskActions } from "./host-task-actions"
import { requestTabActivation } from "./terminal-tabs-shared"
import type { UseDaemonStateResult } from "./use-daemon-state"
import { useSidebarCollapsed, useSidebarWidth } from "./use-sidebar-layout"

/** Structural, so a hook can grow a field without this file changing. */
export interface HostSidebarMountProps {
  readonly terminalWidth: number
  readonly showContent: boolean
  readonly recentTask: Task | null | undefined
  readonly tasks: readonly Task[]
  readonly selectedId: string | null
  readonly selectedTabId: string | null
  readonly selectTask: (id: string) => void
  readonly activateTask: (id: string) => void | Promise<void>
  readonly daemon: Pick<
    UseDaemonStateResult,
    "sidebarEngineState" | "engineTabState" | "engineLifecycle" | "taskJobs" | "rowTokens" | "worktreeChanges"
  >
  readonly actions: WorkspaceTaskActions
  readonly pages: Pick<HostPagesState, "nav" | "setNav" | "goToNav" | "openUpdate">
  readonly focus: FocusContextValue
  readonly inbox: { readonly counts: { readonly total: number }; readonly show: () => void }
  readonly update: { readonly hasUpdate: boolean; readonly latest: string } | null | undefined
  /** The one row verb that must run where the engine is (`useEditorHandles`). */
  readonly onFixChecks: (taskId: string) => void
  readonly runAgain: (task: Task) => void
  readonly activePane: string | null
  readonly zen: boolean
  readonly toggleZen: () => void
  readonly sortMode: TaskSortMode
  readonly moveMode: boolean
  readonly exitMoveMode: () => void
  readonly onLocalMergeRequest: (taskId: string) => void
  readonly onSearchActiveChange: (active: boolean) => void
  readonly cursorTaskIdRef: MutableRefObject<() => string | null>
  readonly openTaskWorktree: (taskId: string) => void
  readonly t: (key: string, params?: Record<string, string | number>) => string
}

/** An unknown stored fold style falls back rather than rendering nothing. */
function railFoldStyle(raw: unknown): CollapsedRailStyle {
  return COLLAPSED_RAIL_STYLES.includes(raw as CollapsedRailStyle)
    ? (raw as CollapsedRailStyle)
    : DEFAULT_COLLAPSED_RAIL_STYLE
}

export function HostSidebarMount(props: HostSidebarMountProps) {
  const { actions, pages, focus, inbox, t } = props
  const kv = useKV()
  const sidebarWidth = useSidebarWidth()
  // Persisted intent, read straight from the store: the resize grip reads it
  // too, and two copies could disagree for a frame.
  const [collapsed, setCollapsed] = useSidebarCollapsed()
  return (
    <HostSidebar
      width={props.showContent ? sidebarWidth.width : props.terminalWidth}
      collapsed={collapsed}
      collapsedStyle={railFoldStyle(kv.get(RAIL_FOLD_STYLE_KEY, DEFAULT_COLLAPSED_RAIL_STYLE))}
      onToggleCollapsed={() => {
        const next = !collapsed
        setCollapsed(next)
        // Folding unmounts the tree and its focused chords, with no chord to
        // unfold, so focus moves off.
        if (next) focus.setFocused("workspace")
      }}
      nav={pages.nav}
      onNavChange={pages.goToNav}
      tasks={props.tasks}
      selectedId={props.selectedId}
      selectedTabId={props.selectedTabId}
      // Picking a task returns the content pane to its terminal.
      onSelect={(id) => {
        props.selectTask(id)
        pages.setNav("terminal")
      }}
      onActivate={(id) => {
        pages.setNav("terminal")
        void props.activateTask(id)
      }}
      // Picking a TAB enters the session: focus to the terminal, or sidebar
      // letter chords (d!) stay live under your typing. Re-clicking the tab
      // you're ALREADY in flips focus back to the sidebar; keyboard enter and
      // a click returning from a rail page are exempt.
      onSelectTab={(taskId, tabId) => {
        const reClick =
          pages.nav === "terminal" &&
          focus.focused !== "sidebar" &&
          taskId === props.selectedId &&
          tabId === props.selectedTabId
        pages.setNav("terminal")
        requestTabActivation(taskId, tabId)
        focus.setFocused(reClick ? "sidebar" : "workspace")
      }}
      engineState={props.daemon.sidebarEngineState}
      engineTabState={props.daemon.engineTabState}
      engineLifecycle={props.daemon.engineLifecycle}
      taskJobs={props.daemon.taskJobs}
      rowTokens={props.daemon.rowTokens}
      worktreeChanges={props.daemon.worktreeChanges}
      focused={props.activePane === "sidebar"}
      // Task lifecycle: the Sidebar's d/r/p/m keys fire these.
      onAddTask={() => void actions.createTask()}
      onDeleteRequest={(id) => void actions.deleteTask(id)}
      onLandRequest={(id) => void actions.landTask(id)}
      onSyncBaseRequest={(id) => void actions.syncBase(id)}
      onRenameRequest={(id) => void actions.renameTask(id)}
      onPinRequest={(id) => void actions.togglePin(id)}
      onSetStatusRequest={(id) => void actions.setStatus(id)}
      onCopyRequest={(id, field) => actions.copyTaskField(id, field)}
      onOpenEditorRequest={props.openTaskWorktree}
      onRenameBranchRequest={(id) => void actions.renameBranch(id)}
      onChangeEngineRequest={(id) => void actions.pickVendor(id)}
      onFieldNotesRequest={actions.showFieldNotes}
      onFixChecksRequest={props.onFixChecks}
      // Created in quick-fork, which owns the pending-prompt slot for the new task.
      onRunAgainRequest={(id) => void actions.confirmRunAgain(id).then((task) => task && props.runAgain(task))}
      moveMode={props.moveMode}
      onMoveRequest={(id, delta) => void actions.moveTask(id, delta)}
      onMoveModeExit={props.exitMoveMode}
      onLocalMergeRequest={props.onLocalMergeRequest}
      onSearchActiveChange={props.onSearchActiveChange}
      sortMode={props.sortMode}
      headerStatus={{
        label: `${t("workspace.inbox.title")} ${inbox.counts.total}`,
        emphasize: inbox.counts.total > 0,
      }}
      onHeaderStatusClick={inbox.show}
      updateChip={props.update?.hasUpdate ? { label: t("update.chip", { version: props.update.latest }) } : null}
      onUpdateChipClick={pages.openUpdate}
      zenActive={props.zen}
      onZenClick={props.toggleZen}
      onFocusRequest={() => focus.setFocused("sidebar")}
      recentTask={props.recentTask}
      cursorTaskIdRef={props.cursorTaskIdRef}
    />
  )
}
