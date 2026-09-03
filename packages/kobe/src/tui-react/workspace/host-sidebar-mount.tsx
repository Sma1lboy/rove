/** @jsxImportSource @opentui/react */
/**
 * The workspace host's sidebar MOUNT: the ~40 props `HostSidebar` needs, and
 * the small closures that adapt the host's hooks to them.
 *
 * The seam is ownership, not line count. `host.tsx` composes the workspace —
 * which hooks exist, which region renders — and every one of those decisions
 * is a line the sidebar's wiring was crowding out. `host-sidebar.tsx` already
 * declares the boundary ("a new sidebar concern lands here instead of
 * accreting on the host"); it just had no place to put the CALLER's half. This
 * is that place: the host now hands over the hook bundles it already has, and
 * every "what does clicking a row mean" decision lives next to the component
 * that answers it.
 *
 * Props are the BUNDLES the host's hooks return, not their fields spread out.
 * Threading twenty individual values would move the wiring without reducing
 * it, and re-introduce the drift the shared `SidebarTaskCallbacks` type exists
 * to prevent.
 */

import type { Task } from "@/types/task"
import type { MutableRefObject } from "react"
import type { TaskSortMode } from "../../tui/panes/sidebar/groups"
import { sidebarWidthFor } from "../../tui/panes/sidebar/view-core"
import type { FocusContextValue } from "../context/focus"
import type { HostPagesState } from "./host-pages"
import { HostSidebar } from "./host-sidebar"
import type { WorkspaceTaskActions } from "./host-task-actions"
import { requestTabActivation } from "./terminal-tabs-shared"
import type { UseDaemonStateResult } from "./use-daemon-state"

/** The host bundles this mount reads, kept structural so a hook can grow a
 *  field without this file learning about it. */
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
    "sidebarEngineState" | "engineTabState" | "engineLifecycle" | "taskJobs" | "worktreeChanges" | "transcriptActivity"
  >
  readonly actions: WorkspaceTaskActions
  readonly pages: Pick<HostPagesState, "nav" | "setNav" | "goToNav" | "openUpdate">
  readonly focus: FocusContextValue
  readonly inbox: { readonly counts: { readonly total: number }; readonly show: () => void }
  readonly update: { readonly hasUpdate: boolean; readonly latest: string } | null | undefined
  /** `onFixChecks` from `useEditorHandles` — the one row verb that has to run
   *  where the engine is, so it lives with the imperative tab handles. */
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

export function HostSidebarMount(props: HostSidebarMountProps) {
  const { actions, pages, focus, inbox, t } = props
  return (
    <HostSidebar
      width={props.showContent ? sidebarWidthFor(props.terminalWidth) : props.terminalWidth}
      nav={pages.nav}
      onNavChange={pages.goToNav}
      tasks={props.tasks}
      selectedId={props.selectedId}
      selectedTabId={props.selectedTabId}
      // Picking a task means "show me that task" — so it returns the content
      // pane to its terminal. Without this the rail page stayed up and
      // selecting a row did nothing visible.
      onSelect={(id) => {
        props.selectTask(id)
        pages.setNav("terminal")
      }}
      onActivate={(id) => {
        pages.setNav("terminal")
        void props.activateTask(id)
      }}
      // Picking a TAB is entering that session: focus moves to the terminal,
      // same as activate — a click that leaves the sidebar's letter chords
      // (d!) live under your typing is how a task gets deleted by accident.
      // Re-clicking the tab you are ALREADY in flips focus back to the
      // sidebar: the first click entered the session, so a second click on the
      // same row means "give me the sidebar". Keyboard enter is exempt
      // (sidebar already focused — enter always means enter the session), as
      // is a click that brings the terminal back from a rail page.
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
      worktreeChanges={props.daemon.worktreeChanges}
      transcriptActivity={props.daemon.transcriptActivity}
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
      // Confirm here, create in quick-fork: it owns the pending-prompt slot
      // that delivers the brief on the NEW task's mount.
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
