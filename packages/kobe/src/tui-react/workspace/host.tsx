/** @jsxImportSource @opentui/react */
/**
 * Default PureTUI workspace: Sidebar | engine Terminal |
 * Files. `useAccessor` subscribes React to framework-free daemon state; imperative
 * terminal handoffs use refs, and worktree-scoped TerminalTabs mount by key.
 * Settings, worktrees, and update surfaces swap in-process instead of exiting.
 */

import { useRenderer, useTerminalDimensions } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"
import { PrefixHud } from "../component/prefix-hud"
import { ToastOverlay } from "../component/toast-overlay"
import { useWhatsNewDialog } from "../component/whats-new-dialog"
import { useFocus } from "../context/focus"
import { useKV } from "../context/kv"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useDaemonNotices } from "../lib/use-daemon-notices"
import { useWelcomeDialog } from "../onboarding/host"
import { useSidebarHostState } from "../panes/sidebar/use-sidebar-host-state.tsx"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { FullWindowPage, useHostBanner } from "./host-banner"
import { HostFilesPane } from "./host-files-pane"
import { WorkspaceFrame } from "./host-footer"
import { useWorkspaceKeybindings } from "./host-keybindings"
import { type BootDialogs, useHostPagesRender, useHostPagesState } from "./host-pages"
import { HostSidebarMount } from "./host-sidebar-mount"
import { useWorkspaceTaskActions } from "./host-task-actions"
import { openTaskWorktreeFor } from "./open-task-worktree"
import { useQuickFork } from "./quick-fork"
import { selfRefreshAction } from "./self-refresh-action"
import { ShowWorkspace } from "./show-workspace"
import { useSidebarResizeGesture } from "./sidebar-resize-gesture"
import { SidebarResizeGrip } from "./sidebar-resize-grip"
import { activeTabIdFor, forgetTaskTabs, setUiEventReporter } from "./terminal-tabs-shared"
import { useAttention } from "./use-attention"
import { requestCreatePR } from "./use-create-pr"
import { useDaemonState } from "./use-daemon-state"
import { useEditorHandles } from "./use-editor-handles"
import { useHostNotifiers } from "./use-host-notifiers"
import { useInboxHost } from "./use-inbox-host"
import { useIssueChat } from "./use-issue-chat"
import { usePrCheckNotifier } from "./use-pr-check-notifier"
import { useScratchShell } from "./use-scratch-shell"
import { useSidebarCollapsed, useSidebarWidth } from "./use-sidebar-layout"
import { useWorkspaceSelection } from "./use-workspace-selection"
import { useZenMode } from "./use-zen-mode"

/** Exported for the render track: banner wiring is only provable on the REAL host. */
export function WorkspaceRoot(props: { orchestrator: RemoteOrchestrator } & BootDialogs) {
  const { theme } = useTheme()
  const inactiveBorder = theme.borderActive
  const dialog = useDialog()
  const kv = useKV()
  const focus = useFocus()
  const dims = useTerminalDimensions()
  const sidebarWidth = useSidebarWidth()
  const [sidebarCollapsed] = useSidebarCollapsed()
  const sidebarResize = useSidebarResizeGesture({
    width: sidebarWidth.width,
    onResize: sidebarWidth.pin,
    onReset: sidebarWidth.reset,
  })
  // The self-refresh must hand the terminal back before its successor inherits it.
  const renderer = useRenderer()
  const notif = useNotifications()
  const orch = props.orchestrator
  // Daemon-broadcast toasts (`kobe api notify` → notice.event).
  useDaemonNotices(orch, notif.notify, dialog)

  const {
    tasks,
    activeTaskId,
    engineState,
    engineLifecycle,
    engineTabState,
    sidebarEngineState,
    inboxItems,
    taskJobs,
    rowTokens,
    worktreeChanges,
  } = useDaemonState(orch)

  // Mutes the host's letter chords while typing in sidebar search.
  const [searchActive, setSearchActive] = useState(false)

  // Selection, adopt-first-focus and the deleting-task PTY sweep share one hook:
  // all answer "which task is the user on".
  const t = useT()

  // `selectedId` reaches the notifiers as a getter, so no ordering against selection.
  const { notifyError, notifyInfo, notifyNeedsInput, notifyWorktreeGone } = useHostNotifiers({
    notif,
    t,
    selectedId: () => selectedId,
  })

  const { selectedId, setSelectedId, selectedTask, selectTask, activateTask } = useWorkspaceSelection({
    orch,
    tasks,
    activeTaskId,
    focusWorkspace: () => focus.setFocused("workspace"),
    kv,
    notifyWorktreeGone,
    notifyError,
  })
  const worktree = selectedTask?.worktreePath || null

  const { sortMode, toggleSortMode, moveMode, setMoveMode, onLocalMergeRequest } = useSidebarHostState({
    kv,
    tasks,
    setSelectedId,
  })

  const inbox = useInboxHost({
    orchestrator: orch,
    items: inboxItems,
    tasks,
    kv,
    dialog,
    selectedId,
    selectTask,
    // `pages` is built below; this only runs on a later user action.
    openAutomations: () => pages.openAutomations(),
    focusWorkspace: () => focus.setFocused("workspace"),
    notifyError,
  })

  // Rising-edge notify for non-selected tasks + the F7 jump handler.
  const { jumpToNextAttention } = useAttention({
    tasks,
    engineState,
    engineTabState,
    inboxItems: inbox.availableItems,
    selectedId,
    kv,
    notif,
    openAttention: inbox.openItem,
    noTasksMessage: t("workspace.attention.none"),
  })

  // PR checks landing (pending → passing/failing) is the other cross-task toast edge.
  usePrCheckNotifier({ tasks, notif })

  // ONE bundle, not destructured: the sidebar mount takes it whole.
  const taskActions = useWorkspaceTaskActions({
    orchestrator: orch,
    tasks: () => tasks,
    dialog,
    notifyError,
    notifyInfo,
    notifyNeedsInput,
    t,
    selectedId: () => selectedId,
    setSelectedId,
    selectedTask: () => selectedTask,
    activateTask,
    forgetTaskTabs: (id) => forgetTaskTabs(kv, id),
  })

  // Imperative tab handles: refs handed by TerminalTabs + FileTree/PR actions.
  const editor = useEditorHandles({ orchestrator: orch, worktree, selectedId, focus, notifyError, activateTask })

  // Quick-fork (ctrl+f): one implementation shared with TerminalTabs (`quick-fork.ts`).
  const quickFork = useQuickFork(orch, {
    selectTask: setSelectedId,
    enterTask: activateTask,
    notifyError,
    notify: notifyInfo,
    t,
  })

  const scratch = useScratchShell({
    orchestrator: orch,
    tasks,
    kv,
    selectedId: () => selectedId,
    selectTask: setSelectedId,
    enterTask: (id) => void activateTask(id),
    forgetTaskTabs: (id) => forgetTaskTabs(kv, id),
    notifyError,
    notifyInfo,
  })

  /* --------- zen mode ---------------------------------------------------- */
  const { zen, toggleZen } = useZenMode({ kv, focus })

  // Tab open/close edges report as plugin events; once per host.
  useEffect(() => {
    setUiEventReporter((kind, taskId, detail) => orch.reportUiEvent(kind, taskId, detail))
    return () => setUiEventReporter(null)
  }, [orch])

  const pages = useHostPagesState(focus, { whatsNewFrom: props.whatsNewFrom ?? null, welcome: props.welcome ?? null })
  // Modals, opened here because the dialog stack lives here.
  useWhatsNewDialog(pages.whatsNewFrom, pages.closeWhatsNew)
  useWelcomeDialog(pages.welcome, pages.closeWelcome)
  // From the module map: the only source covering unmounted TerminalTabs.
  const selectedTabId = selectedId === null ? null : activeTabIdFor(selectedId)
  // Kanban drawer → engine session, via quick-fork's pending-prompt pattern.
  const issueChat = useIssueChat(orch, {
    selectTask: setSelectedId,
    enterTask: activateTask,
    closeKanban: pages.closeKanban,
    notifyError,
    notifyInfo,
  })

  const pageRender = useHostPagesRender({
    orchestrator: orch,
    pages,
    focus,
    dialog,
    kv,
    dims,
    selectedTask,
    activeTaskId,
    tasks,
    engineState,
    startIssueChat: issueChat.start,
    activateTask,
  })

  // `o` and the row menu share this; both pass the cursor row.
  const openTaskWorktree = (id: string): void =>
    openTaskWorktreeFor(id, { tasks, ensureWorktree: orch.ensureWorktree.bind(orch), notifyError })

  // Filled by SidebarTree; every reader is gated on sidebar focus.
  const cursorTaskIdRef = useRef<() => string | null>(() => null)

  // Above the keybindings: it also gates whether the refresh chord registers.
  const banner = useHostBanner(orch, dims.width)
  const refreshRove = (): void => {
    void selfRefreshAction(
      {
        orchestrator: orch,
        renderer,
        confirm: () =>
          DialogConfirm.show(
            dialog,
            t("update.refresh.confirmTitle"),
            t("update.refresh.confirmBody"),
            t("common.cancel"),
            t("update.refresh.confirmLabel"),
          ).then((ok) => ok === true),
        notifyError,
        t,
      },
      banner.refresh.inputs,
    )
  }

  useWorkspaceKeybindings({
    focus,
    dialog,
    pages,
    filesPaneVisible: !zen && pages.nav === "terminal" && pageRender.showSidebar && pageRender.showContent,
    searchActive,
    selectedId,
    cursorTaskId: () => cursorTaskIdRef.current(),
    openTaskWorktree,
    createTask: () => void taskActions.createTask(),
    renameBranch: (id) => void taskActions.renameBranch(id),
    cycleVendor: (id) => void taskActions.cycleVendor(id),
    toggleZen,
    jumpToNextAttention,
    openInbox: inbox.show,
    createPR: () => void editor.onCreatePR(),
    // Park, then enter the row so its workspace mounts and claims the request.
    createPRFor: (id) => {
      requestCreatePR(id)
      activateTask(id)
    },
    // PROPOSED prefix+k: same aim as the row menu, so the same handler.
    fixChecksFor: editor.onFixChecks,
    // PROPOSED prefix+u: same aim, and the merge runs daemon-side.
    syncBaseFor: (id) => void taskActions.syncBase(id),
    // prefix+m: focus the sidebar on the selection (else first task), enter move mode.
    enterMoveMode: () => {
      const target = selectedId ?? tasks[0]?.id
      if (!target) return
      focus.setFocused("sidebar")
      setSelectedId(String(target))
      setMoveMode(true)
    },
    toggleSortMode,
    refresh: { available: banner.refresh.available, run: refreshRove },
  })

  // Null under a dialog: pane focus doesn't change when one opens, and a
  // matched pane binding's preventDefault would starve the dialog's <input>.
  // Borders keep `focus.focused` so the frame stays lit under the backdrop.
  const activePane = dialog.stack.length > 0 ? null : focus.focused

  const fullWindow = pageRender.settingsPage ?? pageRender.fullWindowPage
  if (fullWindow)
    return (
      <FullWindowPage banner={banner.element} background={theme.background}>
        {fullWindow}
      </FullWindowPage>
    )

  return (
    <WorkspaceFrame
      orchestrator={orch}
      onOpenSettings={pages.openSettings}
      banner={banner.element}
      activeTaskId={selectedId}
      activeTabId={selectedTabId}
      onPaneDrag={sidebarResize.onPaneDrag}
      onPaneRelease={sidebarResize.onPaneRelease}
    >
      {/* Tasks sidebar stays visible in zen (tmux parity) — its
          ☯ ZEN chip is also the exit affordance. */}
      {/* Borderless rail (owner call 2026-07-27): no frame, no divider —
          opentui coerces a full frame if borderColor is ever set, so the box
          carries no border prop at all. The workspace frame's left edge is
          the only boundary; sidebar focus shows on the KOBE brand text. */}
      {pageRender.showSidebar ? (
        <HostSidebarMount
          terminalWidth={dims.width}
          showContent={pageRender.showContent}
          recentTask={pageRender.recentTask}
          tasks={tasks}
          selectedId={selectedId}
          selectedTabId={selectedTabId}
          selectTask={selectTask}
          activateTask={activateTask}
          daemon={{
            sidebarEngineState,
            engineTabState,
            engineLifecycle,
            taskJobs,
            rowTokens,
            worktreeChanges,
          }}
          actions={taskActions}
          pages={pages}
          focus={focus}
          inbox={inbox}
          update={banner.update}
          onFixChecks={editor.onFixChecks}
          runAgain={quickFork.runAgain}
          activePane={activePane}
          zen={zen}
          toggleZen={toggleZen}
          sortMode={sortMode}
          moveMode={moveMode}
          exitMoveMode={() => setMoveMode(false)}
          onLocalMergeRequest={onLocalMergeRequest}
          onSearchActiveChange={setSearchActive}
          cursorTaskIdRef={cursorTaskIdRef}
          openTaskWorktree={openTaskWorktree}
          t={t}
        />
      ) : null}

      {pageRender.showContent ? (
        <box
          flexGrow={1}
          flexShrink={1}
          borderStyle="rounded"
          borderColor={focus.focused === "workspace" ? theme.focusAccent : inactiveBorder}
          onMouseUp={() => focus.setFocused("workspace")}
        >
          {/* The rail swaps THIS pane, not the whole window — the task list on
            the left stays live, so selecting a task is how you get back to
            its terminal. */}
          {pageRender.contentPage ?? (
            <ShowWorkspace
              task={selectedTask}
              worktree={worktree}
              orchestrator={orch}
              focused={activePane === "workspace"}
              onRequestFocus={() => focus.setFocused("workspace")}
              onEditorTabReady={editor.onEditorTabReady}
              onEngineSendReady={editor.onEngineSendReady}
              onEnginePasteReady={editor.onEnginePasteReady}
              onDiffTabReady={editor.onDiffTabReady}
              onQuickFork={quickFork.onQuickFork}
              initialPrompt={quickFork.initialPromptFor(selectedTask?.id)}
              onTabVisited={inbox.resolveVisited}
              onScratchExit={scratch.onScratchExit}
              onOpenScratch={scratch.openScratchShell}
              onEngineChosen={taskActions.setVendor}
            />
          )}
        </box>
      ) : null}

      {/* The FileTree lists a WORKTREE's files. A rail page is not about a
          worktree — it reads daemon state that spans projects — so the pane
          would be showing an unrelated tree beside it. Hidden, same as zen
          (and always in narrow — three panes don't fit 46 cols). */}
      {!zen && pageRender.contentPage == null && pageRender.showSidebar && pageRender.showContent ? (
        <HostFilesPane
          sidebarWidth={sidebarWidth.width}
          worktree={worktree}
          prBaseRef={selectedTask?.prStatus?.baseRef}
          focused={activePane === "files"}
          onOpenFile={(relPath) => void editor.onOpenFile(relPath)}
          onOpenDiff={editor.onOpenDiff}
          onMention={editor.onMention}
          onZenToggle={toggleZen}
          onCreatePR={() => void editor.onCreatePR()}
          taskKind={selectedTask?.kind}
          remoteHost={
            selectedTask?.origin && selectedTask.origin.machineId !== "local"
              ? selectedTask.origin.hostLabel
              : undefined
          }
        />
      ) : null}

      {/* Cross-task attention toasts. `useAttention` above fires
          `notif.notify()` on unfocused-task state changes; without this
          overlay mounted, nothing renders them and the bottom-right toast
          silently never appears. Absolute-positioned, under the host's
          NotificationsProvider. */}
      <ToastOverlay />
      {/* Prefix sequence HUD — bottom-left over the Tasks sidebar (the
          terminal column is off-limits: it collided with the engine's own
          status line). Width-capped to the rail so lines never spill into
          the terminal. */}
      <PrefixHud left={1} width={sidebarWidth.width - 2} />
      {/* Drag the rail's right edge. At the FRAME because the gesture has to
          outlive the rail — see sidebar-resize-grip.tsx. Only where there is
          an edge to drag: a fold has a fixed width that is the point of
          folding, and the narrow layout gives the rail the whole terminal,
          with no workspace on the other side to trade cells with. */}
      {pageRender.showSidebar && pageRender.showContent && !sidebarCollapsed ? (
        <SidebarResizeGrip width={sidebarWidth.width} onGripDown={sidebarResize.onGripDown} />
      ) : null}
    </WorkspaceFrame>
  )
}
