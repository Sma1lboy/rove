/** @jsxImportSource @opentui/react */
/**
 * The workspace host's full-page swaps: "which surface occupies the window".
 * Order is precedence (first open page wins), explicit so a future page
 * can't silently shadow one.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import type { WelcomeRequest } from "../../cli/welcome.ts"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import type { TaskEngineState } from "../../client/remote-orchestrator-payloads"
import { type SidebarNav, focusPaneForNav } from "../../tui/panes/sidebar/nav-core"
import type { Task } from "../../types/task"
import { AutomationsPage } from "../component/automations-page"
import { KanbanPage } from "../component/kanban-page"
import { SettingsDialog } from "../component/settings-dialog"
import { UpdatePage } from "../component/update-page"
import { WorkItemsPage } from "../component/work-items-page"
import { WorktreesPage } from "../component/worktrees-page"
import type { FocusContextValue, PaneId } from "../context/focus"
import type { KVContext } from "../context/kv"
import { isNarrowWidth, narrowSurface } from "../lib/narrow-mode"
import type { DialogContext } from "../ui/dialog"

interface HostPageState {
  readonly worktreesOpen: boolean
  readonly automationsOpen: boolean
  readonly workItemsOpen: boolean
  readonly kanbanOpen: boolean
  readonly updateOpen: boolean
}

/** One-shot launch dialogs, resolved at the process entry point: both touch
 *  `state.json`. Mutually exclusive (older stamp vs no stamp). */
export interface BootDialogs {
  readonly whatsNewFrom?: string | null
  readonly welcome?: WelcomeRequest | null
}

export interface HostPagesState extends HostPageState {
  /** Version upgraded FROM when What's New is owed, else null (the dialog
   *  needs the range). A modal on the dialog stack, not a routed page. */
  readonly whatsNewFrom: string | null
  readonly closeWhatsNew: () => void
  /** The owed first-run welcome, else null; mirrors {@link whatsNewFrom}. */
  readonly welcome: WelcomeRequest | null
  readonly closeWelcome: () => void
  readonly nav: SidebarNav
  /** Point the rail without moving focus — task selection uses this. */
  readonly setNav: (next: SidebarNav) => void
  readonly goToNav: (next: SidebarNav) => void
  readonly settingsOpen: boolean
  readonly openSettings: () => void
  readonly closeSettings: () => void
  readonly openWorktrees: () => void
  readonly closeWorktrees: () => void
  readonly openUpdate: () => void
  readonly closeUpdate: () => void
  readonly openKanban: () => void
  readonly closeKanban: () => void
  readonly openAutomations: () => void
  readonly closeAutomations: () => void
  readonly openWorkItems: () => void
  readonly closeWorkItems: () => void
}

/**
 * Which surface the workspace shows. Settings / Worktrees / Update are full
 * swaps; the rail's pages are ONE `nav` value (separate booleans could
 * represent "two open").
 *
 * Opening a rail page moves focus INTO the content pane (`goToNav`): its keys
 * are gated on that focus, else they fall through to sidebar chords.
 */
export function useHostPagesState(
  focus: FocusContextValue,
  /** Resolved by `tui/index.tsx`, not here: this hook mounts in the render
   *  track, where a `state.json` write lands in the operator's real home. */
  opts: BootDialogs = {},
): HostPagesState {
  const [whatsNewFrom, setWhatsNewFrom] = useState<string | null>(opts.whatsNewFrom ?? null)
  // Stable: the dialog opener's effect depends on it.
  const closeWhatsNew = useCallback(() => setWhatsNewFrom(null), [])
  const [welcome, setWelcome] = useState<WelcomeRequest | null>(opts.welcome ?? null)
  const closeWelcome = useCallback(() => setWelcome(null), [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [worktreesOpen, setWorktreesOpen] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [nav, setNav] = useState<SidebarNav>("terminal")
  const goToNav = (next: SidebarNav): void => {
    setNav(next)
    focus.setFocused(focusPaneForNav(next))
  }
  return {
    nav,
    setNav,
    goToNav,
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    worktreesOpen,
    openWorktrees: () => setWorktreesOpen(true),
    closeWorktrees: () => setWorktreesOpen(false),
    updateOpen,
    openUpdate: () => setUpdateOpen(true),
    closeUpdate: () => setUpdateOpen(false),
    kanbanOpen: nav === "kanban",
    openKanban: () => goToNav("kanban"),
    closeKanban: () => goToNav("terminal"),
    automationsOpen: nav === "automations",
    openAutomations: () => goToNav("automations"),
    closeAutomations: () => goToNav("terminal"),
    whatsNewFrom,
    closeWhatsNew,
    welcome,
    closeWelcome,
    workItemsOpen: nav === "issues",
    openWorkItems: () => goToNav("issues"),
    closeWorkItems: () => goToNav("terminal"),
  }
}

export interface HostPageDeps extends HostPageState {
  readonly orchestrator: RemoteOrchestrator | null
  readonly selectedTask: Task | undefined
  readonly closeWorktrees: () => void
  readonly closeAutomations: () => void
  readonly closeWorkItems: () => void
  readonly closeKanban: () => void
  readonly closeUpdate: () => void
  readonly activateTask: (taskId: string) => void
  /** Content pane focused; rail pages gate their bare keys on it. */
  readonly contentFocused: boolean
  readonly startIssueChat: Parameters<typeof KanbanPage>[0]["onStartChat"]
  readonly engineStates: Parameters<typeof KanbanPage>[0]["engineStates"]
}

/** FULL-WINDOW pages (Worktrees, Update) replace everything, sidebar included. */
export function renderFullWindowPage(deps: HostPageDeps): ReactNode | null {
  if (deps.worktreesOpen) {
    return <WorktreesPage orchestrator={deps.orchestrator} onClose={deps.closeWorktrees} />
  }
  if (deps.updateOpen) {
    return <UpdatePage onClose={deps.closeUpdate} />
  }
  return null
}

/** CONTENT-PANE pages the rail swaps; the task list stays beside them. */
export function renderContentPage(deps: HostPageDeps): ReactNode | null {
  const orch = deps.orchestrator

  if (deps.automationsOpen) {
    return (
      <AutomationsPage
        orchestrator={orch}
        focused={deps.contentFocused}
        {...(deps.selectedTask ? { focusRepo: deps.selectedTask.repo } : {})}
        onClose={deps.closeAutomations}
        onOpenTask={(taskId) => {
          deps.closeAutomations()
          deps.activateTask(taskId)
        }}
      />
    )
  }

  if (deps.workItemsOpen) {
    return (
      <WorkItemsPage
        orchestrator={orch}
        focused={deps.contentFocused}
        onClose={deps.closeWorkItems}
        // Opens on the selected task's project, like the kanban.
        {...(deps.selectedTask ? { focusRepo: deps.selectedTask.repo } : {})}
        onOpenTask={(taskId) => {
          deps.closeWorkItems()
          deps.activateTask(taskId)
        }}
      />
    )
  }

  if (deps.kanbanOpen) {
    return (
      <KanbanPage
        orchestrator={orch}
        focused={deps.contentFocused}
        onClose={deps.closeKanban}
        onStartChat={deps.startIssueChat}
        engineStates={deps.engineStates}
        // `c` fires from the sidebar, so the board opens pointed at the
        // SELECTED task's project + its linked story card.
        focusTask={deps.selectedTask ? { id: deps.selectedTask.id, repo: deps.selectedTask.repo } : undefined}
        onOpenTask={(taskId) => {
          deps.closeKanban()
          deps.activateTask(taskId)
        }}
      />
    )
  }

  return null
}

export interface UseHostPagesRenderOpts {
  orchestrator: RemoteOrchestrator
  pages: HostPagesState
  focus: FocusContextValue
  dialog: DialogContext
  kv: KVContext
  dims: { width: number }
  selectedTask: Task | undefined
  activeTaskId: string | null
  tasks: readonly Task[]
  engineState: ReadonlyMap<string, TaskEngineState>
  startIssueChat: HostPageDeps["startIssueChat"]
  activateTask: (taskId: string) => void
}

export interface UseHostPagesRenderResult {
  settingsPage: ReactNode | null
  fullWindowPage: ReactNode | null
  contentPage: ReactNode | null
  showSidebar: boolean
  showContent: boolean
  /** "↩ recent" jump target for narrow mode. */
  recentTask: Task | null
}

/** Page-render + layout decisions: which surface occupies the workspace. */
export function useHostPagesRender(opts: UseHostPagesRenderOpts): UseHostPagesRenderResult {
  const {
    orchestrator,
    pages,
    focus,
    dialog,
    kv,
    dims,
    selectedTask,
    activeTaskId,
    tasks,
    engineState,
    startIssueChat,
    activateTask,
  } = opts

  const activePane: PaneId | null = dialog.stack.length > 0 ? null : focus.focused

  const pageDeps = useMemo<HostPageDeps>(
    () => ({
      orchestrator,
      selectedTask,
      worktreesOpen: pages.worktreesOpen,
      automationsOpen: pages.automationsOpen,
      workItemsOpen: pages.workItemsOpen,
      kanbanOpen: pages.kanbanOpen,
      updateOpen: pages.updateOpen,
      closeWorktrees: pages.closeWorktrees,
      closeAutomations: pages.closeAutomations,
      closeWorkItems: pages.closeWorkItems,
      closeKanban: pages.closeKanban,
      closeUpdate: pages.closeUpdate,
      activateTask: (taskId: string) => void activateTask(taskId),
      startIssueChat,
      engineStates: engineState,
      contentFocused: activePane === "workspace",
    }),
    [orchestrator, selectedTask, pages, startIssueChat, engineState, activePane, activateTask],
  )

  const fullWindowPage = useMemo(() => renderFullWindowPage(pageDeps), [pageDeps])
  const contentPage = useMemo(() => renderContentPage(pageDeps), [pageDeps])

  // Narrow hides the files pane, so focus stranded there falls back to the workspace.
  const narrow = isNarrowWidth(dims.width)
  useEffect(() => {
    if (narrow && focus.focused === "files") focus.setFocused("workspace")
  }, [narrow, focus])
  const surface = narrow
    ? narrowSurface({
        focusedPane: focus.focused,
        hasSelection: selectedTask != null,
        hasOpenPage: contentPage != null,
      })
    : null
  const showSidebar = surface !== "content"
  const showContent = surface !== "sidebar"

  const recentTask = useMemo(
    () => (narrow ? tasks.find((task) => task.id === activeTaskId && !task.deletion) : null) ?? null,
    [narrow, tasks, activeTaskId],
  )

  const settingsPage = pages.settingsOpen ? (
    <box flexGrow={1} backgroundColor="transparent" paddingTop={1}>
      <SettingsDialog kv={kv} orchestrator={orchestrator} onClose={pages.closeSettings} />
    </box>
  ) : null

  return { settingsPage, fullWindowPage, contentPage, showSidebar, showContent, recentTask }
}
