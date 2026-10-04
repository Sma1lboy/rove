/**
 * Central keybinding registry: which chords trigger which action, and what the
 * help dialog (F1) and Tasks-pane footer legend display. Panes register by
 * binding **id** (`bindByIds`), never by chord string.
 *
 *   - `id` is stable; tests and settings persistence key off it.
 *   - `keys[0]` is the canonical chord (shown when there is no `hint`). Extra
 *     chords cover terminals that send the same logical key as different bytes
 *     (`ctrl+k`/`alt+k`) or equivalent keys (`j`/`down`).
 *   - `scope`: global, or registered only while that pane is focused.
 *   - `hint.keys`: display-only pseudo-chord (`j/k`, `1/2/3`) for the F1 cap and
 *     footer legend (`capOf`/`legendCap` in `lib/help-groups.ts`); the real
 *     chords stay individually registered and testable.
 *
 * Users rebind via `~/.rove/settings/keybindings.yaml`; `applyUserKeybindings()`
 * mutates this table in place at boot, so panes and legends pick it up for free.
 *
 * macOS modifiers:
 *   - `ctrl+X`: always works (stable C0 bytes). Use as the primary chord.
 *   - `alt+X`: Option, `ESC X` in legacy mode. Launchers (Raycast, Karabiner,
 *     Alfred) often grab Option+digit first, so never the only path.
 *   - `cmd+X`: Terminal.app/iTerm2/Ghostty keep Cmd+letter as an app shortcut
 *     by default; only forwarding terminals (Kitty, iTerm2 "Send Modifier
 *     Keys", Ghostty `keybind`) deliver it. Register it alongside `ctrl+X` so
 *     it isn't swallowed unbound on those.
 *
 * Sidebar-focused `ctrl+q` is the tmux-style two-stage detach: first returns to
 * Tasks, second exits the attached UI. Plain `q` is the sidebar quit-confirm.
 */

import { CHAT_BINDINGS } from "./keybindings-chat.ts"
import { FILES_BINDINGS } from "./keybindings-files.ts"
import { INBOX_BINDINGS } from "./keybindings-inbox.ts"
import { SIDEBAR_BINDINGS } from "./keybindings-sidebar.ts"

/** Pane scopes that gate where a binding is active. */
export type KobeBindingScope = "global" | "sidebar" | "workspace" | "files" | "inbox" | "terminal"

/** Display override for F1 and the footer legend; without it `keys[0]` shows. */
export type KobeBindingHint = {
  /** Display string for the chord. May be a collapsed pseudo-chord (e.g. "j/k"). */
  keys: string
}

/** A single binding row. */
export type KobeBinding = {
  /** Stable identifier; tests and settings persistence key off it. */
  id: string
  scope: KobeBindingScope
  /**
   * First is canonical. Empty = documentation/hint row only, no chord
   * registered (composer-internal keys the textarea handles, e.g. `chat.send`).
   */
  keys: readonly string[]
  /** Second strokes reached through the configurable PureTUI prefix. */
  prefixKeys?: readonly string[]
  category: string
  description: string
  /** Omitted = the first chord in `keys` shows. */
  hint?: KobeBindingHint
  /** User-facing tier. Only the deliberately small Kobe-owned direct set opts in. */
  presentation?: "onePress"
  /** Let an enabled PTY input binding win this direct chord. */
  yieldToPassthrough?: boolean
}

/** The full keymap. Order within a category is the help-dialog order. */
export const KobeKeymap: readonly KobeBinding[] = [
  // ─── Global ───────────────────────────────────────────────────────────
  {
    id: "help.open",
    scope: "global",
    keys: ["f1"],
    category: "Global",
    description: "Show keybindings help",
    hint: { keys: "F1" },
    presentation: "onePress",
  },
  {
    // Sidebar-only: in the composer/files/terminal `n` is a typed letter, and a
    // global `ctrl+n` would collide with typing muscle memory.
    id: "task.new",
    scope: "sidebar",
    keys: ["n"],
    category: "Sidebar",
    description: "New task",
    hint: { keys: "n" },
  },
  {
    // Prefix, not direct ctrl+n: readline next-history in the embedded
    // terminals owns that chord.
    id: "task.new.global",
    scope: "global",
    keys: [],
    prefixKeys: ["n"],
    category: "Global",
    description: "New task",
  },
  {
    id: "task.openEditor",
    scope: "global",
    keys: [],
    prefixKeys: ["o"],
    category: "Global",
    description: "Open active Task directory in editor",
  },
  // No Scratch-shell chord: it's a trailing choice in the ctrl+e
  // new-conversation dialog. See docs/design/keybinding-decisions.md.
  {
    // Focuses the sidebar in move mode: j/k reorders saved projects; enter/esc exits.
    id: "task.moveMode",
    scope: "global",
    keys: [],
    prefixKeys: ["m"],
    category: "Global",
    description: "Reorder sidebar rows (then j/k)",
  },
  {
    id: "settings.open",
    scope: "global",
    keys: [],
    prefixKeys: [","],
    category: "Global",
    description: "Open settings",
  },
  {
    // PROPOSED, awaiting owner sign-off. Prefix tier because it is rare (once
    // per upgrade) and looks destructive (the UI goes away and comes back).
    // Registered only while a refresh is available, so the guide never
    // advertises a no-op.
    id: "app.refresh",
    scope: "global",
    keys: [],
    prefixKeys: ["r"],
    category: "Global",
    description: "Refresh Rove onto the installed build (after an update)",
  },
  {
    // `prefix+,` (settings.open) is the from-anywhere equivalent.
    id: "settings.open.sidebar",
    scope: "sidebar",
    keys: ["s"],
    category: "Sidebar",
    description: "Open settings",
    hint: { keys: "s" },
  },
  {
    // Sidebar-only: a sidebar utility page, no global companion. NOT `w`/`e`:
    // `keymap-slot-parity.test.ts` uses those as free keys for `sidebar.nav`
    // override testing.
    id: "worktrees.open.sidebar",
    scope: "sidebar",
    keys: ["x"],
    category: "Sidebar",
    description: "Open worktrees",
    hint: { keys: "x" },
  },
  {
    // Rail pages take prefix+1/2/3 in the rail's top-to-bottom order. They swap
    // only the content pane, so the prefix stays live and 1→2→3 hops directly.
    id: "kanban.open",
    scope: "global",
    keys: [],
    prefixKeys: ["1"],
    category: "Global",
    description: "Open kanban (issues board)",
  },
  {
    // Rail row 2 — see kanban.open above.
    id: "automations.open",
    scope: "global",
    keys: [],
    prefixKeys: ["2"],
    category: "Global",
    description: "Open routines (scheduled tasks)",
  },
  {
    // Rail row 3 — see kanban.open above.
    id: "workItems.open",
    scope: "global",
    keys: [],
    prefixKeys: ["3"],
    category: "Global",
    description: "Open GitHub issues (external tracker)",
  },
  {
    // ctrl+q here is the second stage of the native two-stage detach (see
    // focus.sidebar). In the composer, q just types q.
    id: "app.quit",
    scope: "sidebar",
    keys: ["q", "ctrl+q"],
    category: "Sidebar",
    description: "Quit (with confirm)",
    hint: { keys: "q" },
  },
  {
    // ctrl+q is THE escape hatch out of any pane; direct-only, too load-bearing
    // for a two-stroke prefix. Scope "workspace" is for override validation.
    id: "focus.sidebar",
    scope: "workspace",
    keys: ["ctrl+q"],
    category: "Workspace",
    description: "Back to sidebar (tasks)",
    hint: { keys: "ctrl+q" },
    presentation: "onePress",
  },

  // ─── Navigation ───────────────────────────────────────────────────────
  {
    // Separate prev/next ids so either direction rebinds on its own. Direct
    // ctrl+h/j/k/l stay with the engine. h/l because the panes sit side by side.
    id: "focus.previous",
    scope: "global",
    keys: [],
    prefixKeys: ["h"],
    category: "Navigation",
    description: "Focus previous pane (files → workspace → sidebar)",
  },
  {
    // Clamped at the ends, no wrap. `f4` is in RESERVED_GLOBAL_CHORDS
    // (panes/terminal/keys-pure.ts) so it fires from inside the terminal.
    // NOT `tab`: the cycle lands on the terminal, which needs tab for
    // completion (it trapped focus and typed \t into the composer). NOT
    // `shift+tab`: claude's plan-mode chord.
    id: "focus.next",
    scope: "global",
    keys: ["f4"],
    prefixKeys: ["l"],
    category: "Navigation",
    description: "Focus next pane (sidebar → workspace → files)",
    hint: { keys: "f4" },
    presentation: "onePress",
  },
  {
    // Visiting the target resolves it. F-row because it fires from inside the
    // terminal (RESERVED_GLOBAL_CHORDS) without stealing an engine chord. NOT
    // `ctrl+g`: readline/engine abort-editing; reserving it ate claude's ctrl+g.
    id: "attention.next",
    scope: "global",
    keys: ["f7"],
    category: "Navigation",
    description: "Jump to the next available Inbox item",
    hint: { keys: "f7" },
    presentation: "onePress",
  },
  {
    // Keyboard counterpart of the sidebar's ☯ ZEN chip. Prefix-only (f6 passes
    // through to the shell); reachable from the terminal because the prefix's
    // first stroke never passes through.
    id: "workspace.zenToggle",
    scope: "global",
    keys: [],
    prefixKeys: ["z"],
    category: "Navigation",
    description: "Toggle zen mode (hide the files column)",
  },
  {
    // PROPOSED, awaiting owner sign-off. Erase + full repaint for corruption
    // nothing can detect: reflow without a grid change, a background image
    // through a transparent theme, another program scribbling the alt screen.
    // Not direct ctrl+l: inside the terminal that must stay the shell's clear.
    id: "view.redraw",
    scope: "global",
    keys: [],
    prefixKeys: ["r"],
    category: "Global",
    description: "Redraw the screen",
  },
  // ─── Sidebar + Tasks pane ─────────────────────────────────────────────
  // Rows in keybindings-sidebar.ts; spread order is display order.
  ...SIDEBAR_BINDINGS,

  // ─── Workspace (chat) ────────────────────────────────────────────────
  ...CHAT_BINDINGS,

  // ─── Files ────────────────────────────────────────────────────────────
  ...FILES_BINDINGS,

  // ─── Attention Inbox ─────────────────────────────────────────────────
  ...INBOX_BINDINGS,

  // ─── Terminal ─────────────────────────────────────────────────────────
  {
    id: "terminal.scroll-up",
    scope: "terminal",
    keys: ["ctrl+pageup"],
    category: "Terminal",
    description: "Scroll scrollback up",
    hint: { keys: "ctrl+pgup" },
  },
  {
    id: "terminal.scroll-down",
    scope: "terminal",
    keys: ["ctrl+pagedown"],
    category: "Terminal",
    description: "Scroll scrollback down",
  },
  {
    id: "terminal.reset",
    scope: "terminal",
    keys: ["f5"],
    category: "Terminal",
    description: "Reset terminal — kill the current shell and respawn",
    hint: { keys: "f5" },
    presentation: "onePress",
  },
  {
    // PROPOSED, pending owner sign-off. Prefix-only: bare `/` must keep reaching
    // the shell. Mirrors the sidebar's `/`. Adds nothing to TRAPPED_KEYS.
    id: "terminal.search",
    scope: "terminal",
    keys: [],
    prefixKeys: ["/"],
    category: "Terminal",
    description: "Search the scrollback",
  },
  {
    // Registered only while the query row is open. Named by direction because a
    // new query parks on the newest hit, so `return` walks back through history.
    // NOT `shift+return`: without the kitty protocol (off, see
    // host-render-options.ts) enter and shift+enter send the same CR.
    id: "terminal.search.older",
    scope: "terminal",
    keys: ["up", "return"],
    category: "Terminal",
    description: "Scrollback search: walk to the older match",
  },
  {
    id: "terminal.search.newer",
    scope: "terminal",
    keys: ["down"],
    category: "Terminal",
    description: "Scrollback search: walk to the newer match",
  },
  {
    // Only while searching; otherwise esc passes through to the shell (vim).
    id: "terminal.search.cancel",
    scope: "terminal",
    keys: ["escape"],
    category: "Terminal",
    description: "Close scrollback search (restore prior scroll position)",
  },
  // The terminal's bare-key PTY passthrough is intentionally not here: it
  // forwards whatever is typed, it isn't a configurable shortcut.

  // ─── Dialog ───────────────────────────────────────────────────────────
  // No rows: every dialog prints its own chords and is modal, so F1 can't open
  // over one. Rows here would only render while the dialog is closed.
] as const
