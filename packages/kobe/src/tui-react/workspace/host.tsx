/** @jsxImportSource @opentui/react */
/**
 * Default PureTUI workspace: Sidebar | engine Terminal |
 * Files. `useAccessor` subscribes React to framework-free daemon state; imperative
 * terminal handoffs use refs, and worktree-scoped TerminalTabs mount by key.
 * Settings, worktrees, and update surfaces swap in-process instead of exiting.
 */

import { useTerminalDimensions } from "@opentui/react"
import { connectOrStartDaemon } from "@sma1lboy/kobe-daemon/client/daemon-process"
import { useEffect, useRef, useState } from "react"
import { RemoteOrchestrator } from "../../client/remote-orchestrator.ts"
import { sidebarWidthFor } from "../../tui/panes/sidebar/view-core"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { PrefixHud } from "../component/prefix-hud"
import { ToastOverlay } from "../component/toast-overlay"
import { useFocus } from "../context/focus"
import { useKV } from "../context/kv"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { bootPaneHost } from "../lib/host-boot"
import { useAccessor } from "../lib/use-accessor"
import { useDaemonNotices } from "../lib/use-daemon-notices"
import { useLatest } from "../lib/use-latest"
import { useSidebarHostState } from "../panes/sidebar/use-sidebar-host-state.tsx"
import { useDialog } from "../ui/dialog"
import { FullWindowPage, useHostBanner } from "./host-banner"
import { HostFilesPane } from "./host-files-pane"
import { WorkspaceFrame } from "./host-footer"
import { useWorkspaceKeybindings } from "./host-keybindings"
import { useHostPagesRender, useHostPagesState } from "./host-pages"
import { HostSidebarMount } from "./host-sidebar-mount"
import { useWorkspaceTaskActions } from "./host-task-actions"
import { openTaskWorktreeFor } from "./open-task-worktree"
import { useQuickFork } from "./quick-fork"
import { ShowWorkspace } from "./show-workspace"
import { activeTabIdFor, forgetTaskTabs, requestTabActivation, setUiEventReporter } from "./terminal-tabs-shared"
import { useAttention } from "./use-attention"
import { requestCreatePR } from "./use-create-pr"
import { useDaemonState } from "./use-daemon-state"
import { useEditorHandles } from "./use-editor-handles"
import { useInboxHost } from "./use-inbox-host"
import { useIssueChat } from "./use-issue-chat"
import { useScratchShell } from "./use-scratch-shell"
import { type WorktreeGoneEvent, useWorkspaceSelection } from "./use-workspace-selection"
import { useZenMode } from "./use-zen-mode"

/** Exported for the render track: the banner wiring can only be proven by
 *  mounting the REAL host — a test against the banner component alone stays
 *  green even when the mount is deleted. */
export function WorkspaceRoot(props: { orchestrator: RemoteOrchestrator }) {
  const { theme } = useTheme()
  const inactiveBorder = theme.borderActive
  const dialog = useDialog()
  const kv = useKV()
  const focus = useFocus()
  const dims = useTerminalDimensions()
  const notif = useNotifications()
  const orch = props.orchestrator
  // Daemon-broadcast toasts (`kobe api notify` → notice.event).
  useDaemonNotices(orch, notif.notify, dialog)

  // React subscriptions to daemon signals + derived overlays.
  const {
    tasks,
    activeTaskId,
    engineState,
    engineLifecycle,
    engineTabState,
    sidebarEngineState,
    inboxItems,
    taskJobs,
    worktreeChanges,
    transcriptActivity,
  } = useDaemonState(orch)

  // Sidebar-search gate: mutes the host's letter chords while typing. Move
  // mode / toasts live in useSidebarHostState below.
  const [searchActive, setSearchActive] = useState(false)

  // Selection + adopt-first-focus + the deleting-task PTY sweep — one hook in
  // use-workspace-selection.ts, because those three all answer "which task is
  // the user on" and get it wrong together if they drift apart.
  const t = useT()

  // Declared before useWorkspaceSelection so its worktree-gone callback can
  // reach the toast surface; `notif.notify` is stable and the sidebar hook's
  // notifyError/notifyInfo below need `selectedId`, which the selection hook
  // produces. Same shape those two use (see use-sidebar-host-state).
  const notifyWorktreeGone = (event: WorktreeGoneEvent): void => {
    notif.notify({
      kind: "error",
      taskId: event.taskId,
      tabId: "",
      title: t("tasks.toast.worktreeGoneTitle", { title: event.title }),
      body: t("tasks.toast.worktreeGoneBody", { count: String(event.closed), branch: event.branch || "—" }),
    })
  }

  // Same pre-declaration reason as notifyWorktreeGone above: a refused
  // activation must reach the toast surface, and `useSidebarHostState`'s
  // notifyError can't be built yet (it needs `selectedId` from this hook).
  const notifyActivationError = (message: string): void => {
    notif.notify({ kind: "error", taskId: "", tabId: "", title: message })
  }

  const { selectedId, setSelectedId, selectedTask, selectTask, activateTask } = useWorkspaceSelection({
    orch,
    tasks,
    activeTaskId,
    focusWorkspace: () => focus.setFocused("workspace"),
    kv,
    notifyWorktreeGone,
    notifyError: notifyActivationError,
  })
  const worktree = selectedTask?.worktreePath || null

  // Toasts + global sort pref + move-mode — the sidebar-adjacent wiring,
  // extracted to the hook next to the Sidebar itself.
  const { sortMode, toggleSortMode, moveMode, setMoveMode, notifyError, notifyInfo, onLocalMergeRequest } =
    useSidebarHostState({ kv, notif, tasks, selectedId, setSelectedId })

  const inbox = useInboxHost({
    orchestrator: orch,
    items: inboxItems,
    tasks,
    kv,
    dialog,
    selectedId,
    selectTask,
    focusWorkspace: () => focus.setFocused("workspace"),
    notifyError,
    notifyInfo,
  })

  // Cross-task attention: rising-edge notify for non-selected tasks +
  // the global chord's jump-to-next handler. State is engine-owned/neutral.
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

  // Task-action callbacks (new/delete/rename/branch/engine/pin/move)
  // — the shared lib/task-actions flows live in host-task-actions.ts.
  // Kept as ONE bundle rather than destructured: the sidebar mount takes it
  // whole, and naming each verb here only to re-name it there was where the
  // sidebar's wiring started leaking into the host.
  const taskActions = useWorkspaceTaskActions({
    orchestrator: orch,
    tasks: () => tasks,
    dialog,
    notifyError,
    notifyInfo,
    notifyNeedsInput: (message) => notif.notify({ kind: "needs_input", taskId: "", tabId: "", title: message }),
    t,
    selectedId: () => selectedId,
    setSelectedId,
    selectedTask: () => selectedTask,
    activateTask,
    forgetTaskTabs: (id) => forgetTaskTabs(kv, id),
  })

  // Imperative tab handles: refs handed by TerminalTabs + FileTree/PR actions.
  const editor = useEditorHandles({ orchestrator: orch, worktree, selectedId, focus, notifyError, activateTask })

  // Quick-fork (ctrl+f): composer → create+enter → hand the
  // prompt to the new task's TerminalTabs mount (phase 2). Wiring lives in
  // `quick-fork.ts` because the create/enter/pending-prompt shape is identical
  // regardless of host — the other caller is TerminalTabs, and both must stay
  // one implementation.
  const quickFork = useQuickFork(orch, { selectTask: setSelectedId, enterTask: activateTask, notifyError })

  // Scratch temp shell tasks — open gesture, exit deletion, and
  // the quiet adoption loop all live in the hook.
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

  // Tab open/close (and editor-file close) edges report as plugin events
  // through this seam — wired once per host, torn down on unmount.
  useEffect(() => {
    setUiEventReporter((kind, taskId, detail) => orch.reportUiEvent(kind, taskId, detail))
    return () => setUiEventReporter(null)
  }, [orch])

  // Which surface the workspace shows — settings/worktrees/update full swaps
  // plus the rail's one-at-a-time nav. State + rationale in host-pages.tsx.
  const pages = useHostPagesState(focus)
  // The selected task's active tab — the tree marks that exact row as live.
  // Read from the module map rather than threaded through TerminalTabs: the
  // sidebar renders tabs for tasks whose TerminalTabs is not mounted, so the
  // module map is the only source that answers for all of them.
  const selectedTabId = selectedId === null ? null : activeTabIdFor(selectedId)
  // Kanban detail drawer → engine session (create/link/prompt handoff) —
  // quick-fork's pending-prompt pattern, per-placement (use-issue-chat.ts).
  const issueChat = useIssueChat(orch, {
    selectTask: setSelectedId,
    enterTask: activateTask,
    closeKanban: pages.closeKanban,
    notifyError,
    notifyInfo,
  })

  // Page-render + layout decisions (full-window swaps, rail pages, narrow
  // surface, settings standalone) live in host-pages.tsx: "which surface
  // occupies the window" is one decision, separate from how the normal
  // workspace lays out its rails.
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

  // `o` and the row menu's "Open in editor" share this; both pass the row
  // under the cursor (the menu's row IS the cursor row).
  const openTaskWorktree = (id: string): void =>
    openTaskWorktreeFor(id, { tasks, ensureWorktree: orch.ensureWorktree.bind(orch), notifyError })

  // Filled by the mounted SidebarTree; null until it mounts (a rail page,
  // zen), which is fine — every reader is gated on sidebar focus.
  const cursorTaskIdRef = useRef<() => string | null>(() => null)
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
    // A row that is not the mounted task: park, then enter it so its
    // workspace mounts and claims the request.
    createPRFor: (id) => {
      requestCreatePR(id)
      activateTask(id)
    },
    // PROPOSED prefix+k: same aim as the row menu, so the same handler.
    fixChecksFor: editor.onFixChecks,
    // prefix+m — global entry into the sidebar's move mode: focus the
    // sidebar, highlight the selection (falling back to the first task),
    // then j/k reorders the cursor row's level (tab/task/project) and
    // enter/esc exits.
    enterMoveMode: () => {
      const target = selectedId ?? tasks[0]?.id
      if (!target) return
      focus.setFocused("sidebar")
      setSelectedId(String(target))
      setMoveMode(true)
    },
    toggleSortMode,
  })

  // Keybinding focus is suppressed while a dialog overlay is up: pane focus
  // state (sidebar/workspace/files) does NOT change when a dialog opens, so
  // without this the pane's plain-letter bindings keep firing and — because
  // a matched binding calls preventDefault — swallow the keystroke before the
  // dialog's focused <input> can read it (opentui only routes a key to a
  // focused renderable when !defaultPrevented). Border colors keep using the
  // live `focus.focused` so the pane frame stays lit under the dim backdrop.
  const activePane = dialog.stack.length > 0 ? null : focus.focused

  // Top-of-window banner (skew / gone-install) + the update chip's payload —
  // one question, three render paths below. See `host-banner.tsx`.
  const banner = useHostBanner(orch, dims.width)

  const fullWindow = pageRender.settingsPage ?? pageRender.fullWindowPage
  if (fullWindow)
    return (
      <FullWindowPage banner={banner.element} background={theme.background}>
        {fullWindow}
      </FullWindowPage>
    )

  return (
    <WorkspaceFrame orchestrator={orch} onOpenSettings={pages.openSettings} banner={banner.element}>
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
            worktreeChanges,
            transcriptActivity,
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
          worktree={worktree}
          prBaseRef={selectedTask?.prStatus?.baseRef}
          focused={activePane === "files"}
          onOpenFile={(relPath) => void editor.onOpenFile(relPath)}
          onOpenDiff={editor.onOpenDiff}
          onMention={editor.onMention}
          onZenToggle={toggleZen}
          onCreatePR={() => void editor.onCreatePR()}
          taskKind={selectedTask?.kind}
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
      <PrefixHud left={1} width={sidebarWidthFor(dims.width) - 2} />
    </WorkspaceFrame>
  )
}

export async function startWorkspaceHost(): Promise<void> {
  await bootPaneHost({
    logContext: "workspace",
    providers: { kv: true, focus: true, notifications: true },
    setup: async () => {
      const client = await connectOrStartDaemon()
      const orchestrator = new RemoteOrchestrator(client, { role: "gui" })
      await orchestrator.init()
      process.env.KOBE_DAEMON_SOCKET_PATH = client.socketPath
      return {
        root: () => <WorkspaceRoot orchestrator={orchestrator} />,
        onDestroy: () => {
          orchestrator.dispose()
          // Detach, don't kill: hosted PTYs (the `kobe pty-host` process)
          // keep their engine sessions RUNNING in the background and
          // reattach on next boot. Local-backend PTYs (no detach()) are
          // still killed — a child of this process can't outlive it usefully.
          getDefaultPtyRegistry().detachAll()
        },
      }
    },
  })
}
