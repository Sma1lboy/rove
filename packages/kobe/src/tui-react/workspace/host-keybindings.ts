/**
 * Workspace-host keybinding registration — React port of `tui/workspace/
 * host-keybindings.ts` (issue #16 React migration). Owns the four
 * `useBindings` blocks the native workspace needs, plus the quit/exit and
 * pane-cycle helpers only those bindings use.
 *
 * Pure wiring: every handler is a closure the host passes in; this module
 * adds no state of its own beyond the renderer handle `exitApp` needs. See
 * `docs/KEYBINDINGS.md` for the scope/boundary rules these rows follow.
 *
 * Solid→React deltas: `settingsOpen`/`worktreesOpen`/`searchActive`/
 * `selectedId` are plain values (the host re-renders on change), not
 * Accessors — `useBindings`'s config function is re-evaluated on every
 * keypress via a render-refreshed ref (`tui-react/lib/keymap.ts`), so a
 * plain closure over these params is exactly as fresh as the Solid
 * Accessor calls were.
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
  selectedId: string | null
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

  // Cursor semantics, not a ring (owner call 2026-07-25): focus movement
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
        // prefix+z only (owner call 2026-07-17). The configured prefix is
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
        // row shipped in the table (and docs) without a handler here, so
        // the chord was dead outside the sidebar.
        "settings.open": prefixAction(() => deps.pages.openSettings()),
        "files.createPR": prefixAction(() => deps.createPR()),
        "task.openEditor": prefixAction(() => {
          if (deps.selectedId) deps.openTaskWorktree(deps.selectedId)
        }),
      }),
    ],
  }))
  useBindings(() => ({
    enabled: pagesClosed && focus.focused !== "sidebar",
    bindings: bindByIds({ "focus.sidebar": () => focus.setFocused("sidebar") }),
  }))
  useBindings(() => ({
    enabled: pagesClosed && focus.focused === "sidebar",
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
  // Task-lifecycle chords (issue #20 — the tmux Tasks pane's n/b/v set).
  // d/a/r/pin/move fire from the Sidebar's OWN keys via the Request props;
  // these three are host-scoped in both hosts. Gated on sidebar focus + no
  // dialog + search inactive (typing `n` into the search box must not open
  // the new-task dialog — same chord-leak class).
  useBindings(() => ({
    enabled: pagesClosed && focus.focused === "sidebar" && !deps.searchActive,
    bindings: bindByIds({
      "task.new": () => deps.createTask(),
      "tasks.openWorktree": () => {
        if (deps.selectedId) deps.openTaskWorktree(deps.selectedId)
      },
      "tasks.renameBranch": () => {
        const id = deps.selectedId
        if (id) deps.renameBranch(id)
      },
      "tasks.cycleEngine": () => {
        const id = deps.selectedId
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
