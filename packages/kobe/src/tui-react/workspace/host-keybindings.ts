/**
 * Workspace-host keybinding registration: pure wiring over host closures
 * (scope rules: `docs/KEYBINDINGS.md`). `useBindings` re-evaluates its config
 * per keypress, so plain closures over these params read current values.
 */

import { useRenderer } from "@opentui/react"
import { prefixAction } from "../../tui/lib/keymap-dispatch"
import { redrawScreen } from "../../tui/lib/screen-refresh"
import { HelpDialog } from "../component/help-dialog"
import type { FocusContextValue, PaneId } from "../context/focus"
import { bindByIds } from "../context/keybindings"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import type { DialogContext } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import type { HostPagesState } from "./host-pages"
import {
  type WorkspacePageState,
  nextFocusedPane,
  settingsCloseKeysEnabled,
  workspacePagesClosed,
} from "./keybinding-gates"
import { usePluginKeybindings } from "./use-plugin-keybindings"

// The host's real panes, NOT PANE_ORDER: its "terminal" is never mounted here.

export type WorkspaceKeybindingDeps = {
  focus: FocusContextValue
  dialog: DialogContext
  pages: HostPagesState
  /** False while the files pane is unmounted (zen, or a rail page). */
  filesPaneVisible?: boolean
  searchActive: boolean
  /** The ACTIVE task — what the workspace shows. Global-scope verbs act on it. */
  selectedId: string | null
  /** The task under the sidebar CURSOR (diverges from selection after j/k);
   *  sidebar-scope row verbs act on it. */
  cursorTaskId: () => string | null
  openTaskWorktree: (id: string) => void
  createTask: () => void
  renameBranch: (id: string) => void
  cycleVendor: (id: string) => void
  toggleZen: () => void
  jumpToNextAttention: () => void
  openInbox: () => void
  /** prefix+m — focus the sidebar and enter move mode on the current selection. */
  enterMoveMode: () => void
  /** prefix+p / prefix+P — send the Create PR prompt into the engine pane. */
  createPR: () => void
  /** Same action aimed at a sidebar ROW's task: enter it, then send there. */
  createPRFor: (id: string) => void
  /** PROPOSED prefix+k — pull the failing PR checks into that task's engine. */
  fixChecksFor: (id: string) => void
  /** PROPOSED prefix+u — merge that task's base branch into its worktree. */
  syncBaseFor: (id: string) => void
  /** `t` — flip the sidebar task sort between default and recent. */
  toggleSortMode: () => void
  /** PROPOSED prefix+r: restart stale halves onto the installed build.
   *  Absent/unavailable keeps it out of the command guide. */
  refresh?: { readonly available: boolean; readonly run: () => void }
}

export function useWorkspaceKeybindings(deps: WorkspaceKeybindingDeps): void {
  const { focus, dialog } = deps
  const t = useT()
  const renderer = useRenderer()

  /** Restore the terminal BEFORE exiting: a bare process.exit leaves mouse
   *  tracking on, spraying `35;66;18M` junk into the shell. */
  function exitApp(): void {
    try {
      renderer?.destroy()
    } catch (err) {
      // silent-catch-ok: exiting next; no screen for a toast.
      console.error("Rove: renderer.destroy() failed during quit:", err)
    }
    process.exit(0)
  }

  async function quit(): Promise<void> {
    const ok = await DialogConfirm.show(
      dialog,
      t("workspace.quit.confirmTitle"),
      t("workspace.quit.confirmBody"),
      t("common.cancel"),
      t("workspace.quit.confirmLabel"),
    )
    if (ok) exitApp()
  }

  // Clamps at both ends (sidebar ← workspace → files); never wraps.
  function cyclePane(delta: 1 | -1): void {
    const next = nextFocusedPane(focus.focused, delta, { filesVisible: deps.filesPaneVisible !== false })
    if (next) focus.setFocused(next as PaneId)
  }

  // Page gating, unit-tested in test/tui-react/keybinding-gates.test.ts.
  const pages: WorkspacePageState = {
    dialogOpen: deps.dialog.stack.length > 0,
    settingsOpen: deps.pages.settingsOpen,
    worktreesOpen: deps.pages.worktreesOpen,
    updateOpen: deps.pages.updateOpen,
    kanbanOpen: deps.pages.kanbanOpen,
    automationsOpen: deps.pages.automationsOpen,
    workItemsOpen: deps.pages.workItemsOpen,
  }
  const pagesClosed = workspacePagesClosed(pages)

  useBindings(() => ({
    enabled: pagesClosed,
    bindings: [
      ...bindByIds({
        "help.open": () => HelpDialog.show(dialog, focus.focused),
        "focus.previous": prefixAction(() => cyclePane(-1)),
        // f4: reserved from terminal passthrough.
        "focus.next": prefixAction(() => cyclePane(1)),
        "workspace.zenToggle": prefixAction(() => deps.toggleZen()),
        // f7: reserved from terminal passthrough too.
        "attention.next": () => deps.jumpToNextAttention(),
        "inbox.show": prefixAction(() => deps.openInbox()),
        "kanban.open": prefixAction(() => deps.pages.openKanban()),
        "automations.open": prefixAction(() => deps.pages.openAutomations()),
        "workItems.open": prefixAction(() => deps.pages.openWorkItems()),
        "task.moveMode": prefixAction(() => deps.enterMoveMode()),
        // prefix+,: the global companion to the sidebar's bare `s`.
        "settings.open": prefixAction(() => deps.pages.openSettings()),
        // Acts on the active task, or the cursor row while the sidebar has
        // focus; another row is entered first (only the mounted workspace can send).
        "files.createPR": prefixAction(() => {
          const row = focus.focused === "sidebar" ? deps.cursorTaskId() : null
          if (row !== null && row !== deps.selectedId) deps.createPRFor(row)
          else deps.createPR()
        }),
        // Same aim rule; parks the request for a non-active row.
        "files.fixChecks": prefixAction(() => {
          const id = (focus.focused === "sidebar" ? deps.cursorTaskId() : null) ?? deps.selectedId
          if (id) deps.fixChecksFor(id)
        }),
        // Same aim rule; the merge runs in the daemon, no mounted engine needed.
        "files.syncBase": prefixAction(() => {
          const id = (focus.focused === "sidebar" ? deps.cursorTaskId() : null) ?? deps.selectedId
          if (id) deps.syncBaseFor(id)
        }),
        // Same aim rule.
        "task.openEditor": prefixAction(() => {
          const id = (focus.focused === "sidebar" ? deps.cursorTaskId() : null) ?? deps.selectedId
          if (id) deps.openTaskWorktree(id)
        }),
      }),
    ],
  }))
  // New task: everywhere but a dialog, Settings, or the sidebar search box.
  useBindings(() => ({
    enabled: !pages.dialogOpen && !pages.settingsOpen && !deps.searchActive,
    bindings: bindByIds({ "task.new.global": () => deps.createTask() }),
  }))
  useBindings(() => ({
    enabled: pagesClosed && focus.focused !== "sidebar",
    bindings: bindByIds({ "focus.sidebar": () => focus.setFocused("sidebar") }),
  }))
  // PROPOSED prefix+r: redraw and refresh share the stroke with complementary
  // gates, so exactly ONE is registered (no shadowed-chord warning).
  //
  // Redraw: erase + full repaint. Off while a refresh is available (it relaunches anyway).
  useBindings(() => ({
    enabled: pagesClosed && deps.refresh?.available !== true,
    bindings: bindByIds({
      "view.redraw": prefixAction(() => {
        if (renderer) redrawScreen(renderer)
      }),
    }),
  }))
  // Refresh: registered only when available, since the command guide lists
  // registered bindings. Not gated on `pagesClosed`: the Update page is where
  // a user who just updated stands.
  useBindings(() => ({
    enabled: !pages.dialogOpen && deps.refresh?.available === true,
    bindings: bindByIds({ "app.refresh": prefixAction(() => deps.refresh?.run()) }),
  }))
  // Search-inactive gate: the raw search listener only sees unclaimed keys.
  useBindings(() => ({
    enabled: pagesClosed && focus.focused === "sidebar" && !deps.searchActive,
    bindings: bindByIds({
      // SLOT_CONTRACTS: slot 0 = quit confirm, slot 1 = hard exit.
      "app.quit": (_evt, slot) => {
        if (slot === 1) {
          exitApp()
          return
        }
        void quit()
      },
      "settings.open.sidebar": () => deps.pages.openSettings(),
      "worktrees.open.sidebar": () => deps.pages.openWorktrees(),
      "tasks.update": () => deps.pages.openUpdate(),
    }),
  }))
  // n/b/v: gated on sidebar focus, no dialog, search inactive. They act on
  // the CURSOR row, not the active task: `b`/`v` rewrite a real worktree.
  useBindings(() => ({
    enabled: pagesClosed && focus.focused === "sidebar" && !deps.searchActive,
    bindings: bindByIds({
      "task.new": () => deps.createTask(),
      "tasks.openWorktree": () => {
        const id = deps.cursorTaskId()
        if (id) deps.openTaskWorktree(id)
      },
      "tasks.renameBranch": () => {
        const id = deps.cursorTaskId()
        if (id) deps.renameBranch(id)
      },
      "tasks.cycleEngine": () => {
        const id = deps.cursorTaskId()
        if (id) deps.cycleVendor(id)
      },
      // Right arrow: focus the workspace terminal.
      "tasks.focusEngine": () => focus.setFocused("workspace"),
      "sidebar.sort": () => deps.toggleSortMode(),
    }),
  }))
  // Settings page close keys; gated on an empty dialog stack so a sub-dialog keeps esc.
  useBindings(() => ({
    enabled: settingsCloseKeysEnabled(pages),
    bindings: pageCloseBindings(deps.pages.closeSettings),
  }))
  // Registered LAST: workspace-open-worktree-bindings.test indexes registrations.
  usePluginKeybindings(pagesClosed)
}
