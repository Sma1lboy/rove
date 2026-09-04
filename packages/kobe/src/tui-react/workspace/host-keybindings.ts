/**
 * Workspace-host keybinding registration. Owns the four `useBindings` blocks
 * the native workspace needs, plus the quit/exit and pane-cycle helpers only
 * those bindings use.
 *
 * Pure wiring: every handler is a closure the host passes in; this module
 * adds no state of its own beyond the renderer handle `exitApp` needs. See
 * `docs/KEYBINDINGS.md` for the scope/boundary rules these rows follow.
 *
 * `settingsOpen`/`worktreesOpen`/`searchActive`/`selectedId` are plain values
 * (the host re-renders on change), and `useBindings`'s config function is
 * re-evaluated on every keypress via a render-refreshed ref
 * (`tui-react/lib/keymap.ts`) — so a plain closure over these params reads
 * the current value, not the one from its registering render.
 */

import { useRenderer } from "@opentui/react"
import { prefixAction } from "../../tui/lib/keymap-dispatch"
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

// Cycle order for focus.next — the host's real panes, NOT the context's
// PANE_ORDER: that includes "terminal", which this host never mounts, and
// cycling focus onto an unmounted pane would strand it.

export type WorkspaceKeybindingDeps = {
  focus: FocusContextValue
  dialog: DialogContext
  pages: HostPagesState
  /** False while the files pane is unmounted (zen, or a rail page). */
  filesPaneVisible?: boolean
  searchActive: boolean
  /** The ACTIVE task — what the workspace shows. Global-scope verbs act on it. */
  selectedId: string | null
  /**
   * The task under the sidebar CURSOR (null on a non-task row or an empty
   * tree). `j`/`k` move the cursor without selecting, so the two diverge the
   * moment the user walks the tree; sidebar-scope row verbs act on this one,
   * like the tree's own `d`/`r`/`P` do.
   */
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
}

export function useWorkspaceKeybindings(deps: WorkspaceKeybindingDeps): void {
  const { focus, dialog } = deps
  const t = useT()
  const renderer = useRenderer()

  /**
   * Restore the terminal BEFORE exiting — a bare process.exit leaves mouse
   * tracking / kitty keyboard on, spraying `35;66;18M`-style junk into the
   * user's shell. destroy() also runs the render options' onDestroy
   * (orchestrator dispose).
   */
  function exitApp(): void {
    try {
      renderer?.destroy()
    } catch (err) {
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

  // Cursor semantics, not a ring: focus movement
  // clamps at both ends — sidebar ← workspace → files — instead of
  // wrapping, so "previous" from the sidebar never jumps to files.
  function cyclePane(delta: 1 | -1): void {
    const next = nextFocusedPane(focus.focused, delta, { filesVisible: deps.filesPaneVisible !== false })
    if (next) focus.setFocused(next as PaneId)
  }

  // One named predicate instead of inline `dialog.stack.length === 0 && …`
  // expressions — the open-page gating contract is unit-tested in
  // test/tui-react/keybinding-gates.test.ts.
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
        // f4 — reserved from terminal passthrough, so the cycle behaves
        // identically from every pane including inside the terminal.
        "focus.next": prefixAction(() => cyclePane(1)),
        // prefix+z only. The configured prefix is
        // Kobe-global, so this remains reachable inside the terminal pane.
        "workspace.zenToggle": prefixAction(() => deps.toggleZen()),
        // f7 — reserved from terminal passthrough too, so "jump to the
        // next waiting task" works even while focused inside the engine.
        "attention.next": () => deps.jumpToNextAttention(),
        "inbox.show": prefixAction(() => deps.openInbox()),
        "kanban.open": prefixAction(() => deps.pages.openKanban()),
        "automations.open": prefixAction(() => deps.pages.openAutomations()),
        "workItems.open": prefixAction(() => deps.pages.openWorkItems()),
        "task.moveMode": prefixAction(() => deps.enterMoveMode()),
        // prefix+, — the global companion to the sidebar's bare `s`. The
        // row exists in the table (and docs); without a handler here the
        // chord is dead outside the sidebar.
        "settings.open": prefixAction(() => deps.pages.openSettings()),
        // Global scope, so it acts on the active task — except while the
        // sidebar has focus, where the highlighted row is what the user
        // means (the same rule `task.openEditor` follows below). Aiming at
        // another row has to enter it first: the send closure belongs to
        // the mounted workspace, so there is no other task to send into.
        "files.createPR": prefixAction(() => {
          const row = focus.focused === "sidebar" ? deps.cursorTaskId() : null
          if (row !== null && row !== deps.selectedId) deps.createPRFor(row)
          else deps.createPR()
        }),
        // Same aim rule as `files.createPR` above; the action itself parks
        // the request when the row is not the active task.
        "files.fixChecks": prefixAction(() => {
          const id = (focus.focused === "sidebar" ? deps.cursorTaskId() : null) ?? deps.selectedId
          if (id) deps.fixChecksFor(id)
        }),
        // Same aim rule again; the merge itself runs in the daemon, so unlike
        // fix-checks it does not need the row's engine to be mounted.
        "files.syncBase": prefixAction(() => {
          const id = (focus.focused === "sidebar" ? deps.cursorTaskId() : null) ?? deps.selectedId
          if (id) deps.syncBaseFor(id)
        }),
        // Global scope, so it acts on the active task — except while the
        // sidebar has focus, where the highlighted row is what the user means.
        "task.openEditor": prefixAction(() => {
          const id = (focus.focused === "sidebar" ? deps.cursorTaskId() : null) ?? deps.selectedId
          if (id) deps.openTaskWorktree(id)
        }),
      }),
    ],
  }))
  // New task belongs everywhere but a dialog, Settings, or the sidebar
  // search box — including the Worktrees and Update full-window pages and
  // the terminal (the prefix's first stroke does not pass through).
  useBindings(() => ({
    enabled: !pages.dialogOpen && !pages.settingsOpen && !deps.searchActive,
    bindings: bindByIds({ "task.new.global": () => deps.createTask() }),
  }))
  useBindings(() => ({
    enabled: pagesClosed && focus.focused !== "sidebar",
    bindings: bindByIds({ "focus.sidebar": () => focus.setFocused("sidebar") }),
  }))
  // Same search-inactive gate as the task-lifecycle group below: while the
  // sidebar search box is active, `s`/`x`/`u` (and the group's bare `q`
  // quit chord) must land in the query, not dispatch — the raw search
  // listener only sees keystrokes the keymap left unclaimed.
  useBindings(() => ({
    enabled: pagesClosed && focus.focused === "sidebar" && !deps.searchActive,
    bindings: bindByIds({
      // Slot dispatch (SLOT_CONTRACTS): slot 0 = quit confirm, slot 1 =
      // hard exit — so user rebinds keep both verbs without inspecting
      // the event's modifiers.
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
  // Task-lifecycle chords — the n/b/v set.
  // d/a/r/pin/move fire from the Sidebar's OWN keys via the Request props;
  // these three are host-scoped in both hosts. Gated on sidebar focus + no
  // dialog + search inactive (typing `n` into the search box must not open
  // the new-task dialog — same chord-leak class). Like the tree's own row
  // verbs they act on the CURSOR row, not the active task: after a `j`
  // without enter the two differ, and `b`/`v` rewrite a real worktree.
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
      // Right arrow — the tmux Tasks pane's "go right into the engine"
      // gesture (tasks.focusEngine), same row, pure-TUI equivalent: focus
      // the workspace terminal.
      "tasks.focusEngine": () => focus.setFocused("workspace"),
      // `t` toggles the global task sort. The state lives in
      // useSidebarHostState; this just exposes the existing flip.
      "sidebar.sort": () => deps.toggleSortMode(),
    }),
  }))
  // Page-level close keys for the settings swap — mirrors settings/host.tsx's
  // standalone page (no enclosing dialog stack to own esc/Ctrl+C, so the
  // page binds them itself; gated on an empty dialog stack so a sub-dialog,
  // e.g. the engine-command editor, keeps esc/typing for itself).
  useBindings(() => ({
    enabled: settingsCloseKeysEnabled(pages),
    bindings: pageCloseBindings(deps.pages.closeSettings),
  }))
  // User `plugins:` chords — same open-page gating as the workspace rows.
  // Registered LAST so the catalogue registrations keep their positional
  // order (workspace-open-worktree-bindings.test indexes registrations).
  usePluginKeybindings(pagesClosed)
}
