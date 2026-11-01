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
import type { SectionId } from "../../tui/component/settings-dialog/model"
import { type SidebarNav, focusPaneForNav } from "../../tui/panes/sidebar/nav-core"
import type { Task } from "../../types/task"
import { SettingsDialog } from "../component/settings-dialog"
import { UpdatePage } from "../component/update-page"
import { WorktreesPage } from "../component/worktrees-page"
import type { FocusContextValue, PaneId } from "../context/focus"
import type { KVContext } from "../context/kv"
import { isNarrowWidth, narrowSurface } from "../lib/narrow-mode"
import { type PageEntry, usePageEntries } from "../pages/registry"
import type { DialogContext } from "../ui/dialog"
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

export interface HostPageDeps extends HostPageState {
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

/** CONTENT-PANE pages the rail swaps; the task list stays beside them. Null for `terminal` or an unregistered id. */
export function renderContentPage(deps: HostPageDeps): ReactNode | null {
  const Page = deps.pages.find((page) => page.id === deps.nav)?.component
  if (!Page) return null
  return (
    <Page
      orchestrator={deps.orchestrator}
      focused={deps.contentFocused}
      onClose={deps.closePage}
      onOpenTask={(taskId, tabId) => {
        deps.closePage()
        deps.activateTask(taskId)
        if (tabId) requestTabActivation(taskId, tabId)
      }}
      selectedTask={deps.selectedTask}
      engineStates={deps.engineStates}
    />
  )
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
  const pageEntries = usePageEntries()

  const activePane: PaneId | null = dialog.stack.length > 0 ? null : focus.focused

  const pageDeps = useMemo<HostPageDeps>(
    () => ({
      orchestrator,
      selectedTask,
      nav: pages.nav,
      pages: pageEntries,
      worktreesOpen: pages.worktreesOpen,
      updateOpen: pages.updateOpen,
      closeWorktrees: pages.closeWorktrees,
      closePage: pages.closePage,
      closeUpdate: pages.closeUpdate,
      activateTask: (taskId: string) => void activateTask(taskId),
      engineStates: engineState,
      contentFocused: activePane === "workspace",
    }),
    [orchestrator, selectedTask, pages, pageEntries, engineState, activePane, activateTask],
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
        onClose={pages.closeSettings}
      />
    </box>
  ) : null

  return { settingsPage, fullWindowPage, contentPage, showSidebar, showContent, recentTask }
}
