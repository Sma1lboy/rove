/** @jsxImportSource @opentui/react */
/**
 * The workspace host's full-page swaps: "which surface occupies the window".
 * Order is precedence (first open page wins), explicit so a future page
 * can't silently shadow one.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { WelcomeRequest } from "../../cli/welcome.ts"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import type { TaskEngineState } from "../../client/remote-orchestrator-payloads"
import { isNarrowWidth, narrowSurface } from "../../lib/narrow-mode"
import type { SectionId } from "../../settings/model"
import type { NewTaskDialogOptions, NewTaskInput } from "../../tui/component/new-task-dialog/state"
import { type SidebarNav, focusPaneForNav } from "../../tui/panes/sidebar/nav-core"
import type { Task } from "../../types/task"
import { NewTaskPage } from "../component/new-task-dialog"
import { SettingsDialog } from "../component/settings-dialog"
import { UpdatePage } from "../component/update-page"
import { WorktreesPage } from "../component/worktrees-page"
import type { FocusContextValue, PaneId } from "../context/focus"
import type { KVContext } from "../context/kv"
import { type PageEntry, usePageEntries } from "../pages/registry"
import type { DialogContext } from "../ui/dialog"
import { useLegacyAdoptPrompt } from "./legacy-adopt-prompt"
import { requestTabActivation } from "./terminal-tabs-shared"

interface HostPageState {
  readonly worktreesOpen: boolean
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
  /** The section the open Settings page lands on; absent = its first. */
  readonly settingsSection?: SectionId
  readonly openSettings: (section?: SectionId) => void
  readonly closeSettings: () => void
  readonly openWorktrees: () => void
  readonly closeWorktrees: () => void
  readonly openUpdate: () => void
  readonly closeUpdate: () => void
  /** Show a registered page (its rail id) and focus it. */
  readonly openPage: (id: string) => void
  /** Back to the selected task's terminal. */
  readonly closePage: () => void
}

/**
 * Which surface the workspace shows. Settings / Worktrees / Update are full
 * swaps; the rail's pages are ONE `nav` value, a page id from the registry.
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
  const [settingsSection, setSettingsSection] = useState<SectionId | undefined>(undefined)
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
    settingsSection,
    openSettings: (section) => {
      setSettingsSection(section)
      setSettingsOpen(true)
    },
    closeSettings: () => setSettingsOpen(false),
    worktreesOpen,
    openWorktrees: () => setWorktreesOpen(true),
    closeWorktrees: () => setWorktreesOpen(false),
    updateOpen,
    openUpdate: () => setUpdateOpen(true),
    closeUpdate: () => setUpdateOpen(false),
    openPage: goToNav,
    closePage: () => goToNav("terminal"),
    whatsNewFrom,
    closeWhatsNew,
    welcome,
    closeWelcome,
  }
}

/** The content pane's New task page: a `nav` value outside the registry, since it needs a pending request. */
const NEW_TASK_NAV = "new-task"

/** One open New task page and the caller awaiting its answer. */
interface NewTaskRequest {
  /** Fresh per request: a `+` pressed while the page is open re-mounts it on the new project. */
  readonly id: number
  readonly defaultRepo: string
  readonly savedRepos: readonly string[]
  readonly options: NewTaskDialogOptions
  readonly resolve: (value: NewTaskInput | undefined) => void
}

export interface NewTaskPageState {
  readonly request: NewTaskRequest | null
  /** Show the page and resolve with its answer; leaving it any other way resolves `undefined`. */
  readonly prompt: (
    defaultRepo: string,
    savedRepos: readonly string[],
    options: NewTaskDialogOptions,
  ) => Promise<NewTaskInput | undefined>
  /** A cancel returns to the task list; a submit leaves focus for the task it creates. */
  readonly finish: (value: NewTaskInput | undefined) => void
}

export function useNewTaskPage(
  pages: Pick<HostPagesState, "nav" | "setNav" | "goToNav">,
  /** The page is a form: it takes the keys however it was opened. */
  focusContent: () => void,
): NewTaskPageState {
  const [request, setRequest] = useState<NewTaskRequest | null>(null)
  const nextId = useRef(0)
  const open = request !== null
  // An effect, so it lands after the sidebar click that opened the page has claimed focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusContent is a fresh closure each render
  useEffect(() => {
    if (open) focusContent()
  }, [open])
  // Every way off the page (a task picked, another page opened) is a cancel.
  useEffect(() => {
    if (!request || pages.nav === NEW_TASK_NAV) return
    request.resolve(undefined)
    setRequest(null)
  }, [request, pages.nav])
  return {
    request,
    prompt: (defaultRepo, savedRepos, options) =>
      new Promise((resolve) => {
        request?.resolve(undefined)
        setRequest({ id: ++nextId.current, defaultRepo, savedRepos, options, resolve })
        pages.goToNav(NEW_TASK_NAV)
      }),
    finish: (value) => {
      request?.resolve(value)
      setRequest(null)
      if (value) pages.setNav("terminal")
      else pages.goToNav("terminal")
    },
  }
}

export interface HostPageDeps extends HostPageState {
  /** Absent in a host with no New task page. */
  readonly newTask?: Pick<NewTaskPageState, "request" | "finish">
  readonly orchestrator: RemoteOrchestrator
  readonly selectedTask: Task | undefined
  /** The rail's current page id, or `terminal`. */
  readonly nav: SidebarNav
  readonly pages: readonly PageEntry[]
  readonly closeWorktrees: () => void
  readonly closePage: () => void
  readonly closeUpdate: () => void
  readonly activateTask: (taskId: string) => void
  /** Content pane focused; rail pages gate their bare keys on it. */
  readonly contentFocused: boolean
  readonly engineStates: ReadonlyMap<string, TaskEngineState>
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

/** Leave any page, enter the task, and land on `tabId` when given. */
export function openTaskOnTab(closePage: () => void, activateTask: (taskId: string) => unknown) {
  return (taskId: string, tabId?: string): void => {
    closePage()
    void activateTask(taskId)
    if (tabId) requestTabActivation(taskId, tabId)
  }
}

/** CONTENT-PANE pages the rail swaps; the task list stays beside them. Null for `terminal` or an unregistered id. */
export function renderContentPage(deps: HostPageDeps): ReactNode | null {
  const newTask = deps.newTask?.request
  if (newTask && deps.nav === NEW_TASK_NAV) {
    return (
      <NewTaskPage
        key={newTask.id}
        defaultRepo={newTask.defaultRepo}
        savedRepos={newTask.savedRepos}
        options={newTask.options}
        focused={deps.contentFocused}
        onDone={deps.newTask.finish}
      />
    )
  }
  const Page = deps.pages.find((page) => page.id === deps.nav)?.component
  if (!Page) return null
  return (
    <Page
      orchestrator={deps.orchestrator}
      focused={deps.contentFocused}
      onClose={deps.closePage}
      onOpenTask={openTaskOnTab(deps.closePage, deps.activateTask)}
      selectedTask={deps.selectedTask}
      engineStates={deps.engineStates}
    />
  )
}

export interface UseHostPagesRenderOpts {
  orchestrator: RemoteOrchestrator
  pages: HostPagesState
  newTask?: NewTaskPageState
  focus: FocusContextValue
  dialog: DialogContext
  kv: KVContext
  dims: { width: number }
  selectedTask: Task | undefined
  activeTaskId: string | null
  tasks: readonly Task[]
  engineState: ReadonlyMap<string, TaskEngineState>
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
  const { orchestrator, pages, focus, dialog, kv, dims, selectedTask, activeTaskId, tasks, engineState, activateTask } =
    opts
  const { newTask } = opts
  const pageEntries = usePageEntries()
  useLegacyAdoptPrompt(orchestrator, {
    dialog,
    kv,
    blocked: pages.whatsNewFrom !== null || pages.welcome !== null,
    enterTask: activateTask,
  })

  const activePane: PaneId | null = dialog.stack.length > 0 ? null : focus.focused

  const pageDeps = useMemo<HostPageDeps>(
    () => ({
      orchestrator,
      selectedTask,
      nav: pages.nav,
      pages: pageEntries,
      worktreesOpen: pages.worktreesOpen,
      updateOpen: pages.updateOpen,
      newTask,
      closeWorktrees: pages.closeWorktrees,
      closePage: pages.closePage,
      closeUpdate: pages.closeUpdate,
      activateTask: (taskId: string) => void activateTask(taskId),
      engineStates: engineState,
      contentFocused: activePane === "workspace",
    }),
    [orchestrator, selectedTask, pages, newTask, pageEntries, engineState, activePane, activateTask],
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
      <SettingsDialog
        kv={kv}
        orchestrator={orchestrator}
        initialSection={pages.settingsSection}
        onCheckUpdate={() => {
          pages.closeSettings()
          pages.openUpdate()
        }}
        onClose={pages.closeSettings}
      />
    </box>
  ) : null

  return { settingsPage, fullWindowPage, contentPage, showSidebar, showContent, recentTask }
}
