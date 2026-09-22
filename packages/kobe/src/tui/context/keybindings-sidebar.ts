/**
 * `sidebar.*` / `tasks.*` rows: plain {@link KobeBinding} data spread into
 * `keybindings-table.ts`, which owns the contract (spread order = display
 * order; ids are what `bindByIds` and user overrides key off). A row's file is
 * decided by its `scope`, nothing else.
 */

import type { KobeBinding } from "./keybindings-table.ts"

export const SIDEBAR_BINDINGS: readonly KobeBinding[] = [
  // ─── Sidebar ──────────────────────────────────────────────────────────
  {
    // POSITIONAL: alternating [down, up] pairs — slot dispatch
    // (SLOT_CONTRACTS in lib/keymap-overrides.ts). Overrides may supply
    // any even chord count, e.g. `sidebar.nav: [w, s]`.
    id: "sidebar.nav",
    scope: "sidebar",
    keys: ["j", "k", "down", "up"],
    category: "Sidebar",
    description: "Move cursor up/down",
    hint: { keys: "j/k" },
  },
  {
    id: "sidebar.select",
    scope: "sidebar",
    keys: ["return"],
    category: "Sidebar",
    description: "Open the selected task",
    hint: { keys: "enter" },
  },
  {
    // The tree never folds, so `l` means "go in": on a tab row, enter its chat.
    id: "sidebar.tree.open",
    scope: "sidebar",
    keys: ["l", "space"],
    category: "Sidebar",
    description: "Open the row under the cursor (a tab row enters its chat)",
    hint: { keys: "l" },
  },
  {
    // Slot pair [top, bottom]: slot 0 (g) arms/completes the gg
    // double-tap, slot 1 (shift+g) jumps to the bottom.
    id: "sidebar.goto",
    scope: "sidebar",
    keys: ["g", "shift+g"],
    category: "Sidebar",
    description: "Top / bottom of list (gg or shift-G)",
  },
  {
    id: "sidebar.rename",
    scope: "sidebar",
    keys: ["r"],
    category: "Sidebar",
    description: "Rename task",
    hint: { keys: "r" },
  },
  {
    // Explicit shift+m chord: an evt.shift gate in the handler would make the
    // id un-rebindable (FIXED_BINDING_IDS).
    id: "sidebar.localMerge",
    scope: "sidebar",
    keys: ["shift+m"],
    category: "Sidebar",
    description: "Reorder row (Shift+M, then j/k)",
    hint: { keys: "M" },
  },
  {
    // Explicit shift+p (see sidebar.localMerge); a stray lowercase `p` matches
    // nothing, so it can't churn the flag. Pinned tasks float to the top, just
    // below the "main" rows, which ignore it (implicitly pinned).
    id: "sidebar.pin",
    scope: "sidebar",
    keys: ["shift+p"],
    category: "Sidebar",
    description: "Pin / unpin task at top (Shift+P)",
    hint: { keys: "P" },
  },
  {
    id: "sidebar.sort",
    scope: "sidebar",
    keys: ["t"],
    category: "Sidebar",
    description: "Switch task sort (default ↔ recent)",
    hint: { keys: "t" },
  },
  {
    id: "sidebar.delete",
    scope: "sidebar",
    keys: ["d"],
    category: "Sidebar",
    description: "Delete task (with confirm)",
    hint: { keys: "d" },
  },
  {
    // Inline search at the top of the sidebar: fuzzy on title + repo basename.
    // While active the single-letter chords (j/k/g/G/d/r/P/m) de-register so
    // they type into the input.
    id: "sidebar.search.enter",
    scope: "sidebar",
    keys: ["/"],
    category: "Sidebar",
    description: "Search tasks (fuzzy filter)",
    hint: { keys: "/" },
  },
  {
    // Only while searching; j/k deliberately unbound so they reach the input.
    // POSITIONAL: [down, up] pairs (slot dispatch).
    id: "sidebar.search.nav",
    scope: "sidebar",
    keys: ["down", "up"],
    category: "Sidebar",
    description: "Move highlight in search results",
  },
  {
    id: "sidebar.search.submit",
    scope: "sidebar",
    keys: ["return"],
    category: "Sidebar",
    description: "Select search match and exit search",
  },
  {
    // Only registered while searching; otherwise the sidebar has no esc handler.
    id: "sidebar.search.cancel",
    scope: "sidebar",
    keys: ["escape"],
    category: "Sidebar",
    description: "Cancel search (restore prior selection)",
  },

  // ─── Tasks pane ───────────────────────────────────────────────────────
  // The standalone Tasks pane (`kobe tasks`, src/tui/tasks-pane/host.tsx)
  // binds these via `bindByIds`, so user overrides apply. n/s/r/d/M/t come
  // from the Sidebar/Global rows above.
  {
    id: "tasks.openWorktree",
    scope: "sidebar",
    keys: ["o"],
    category: "Tasks pane",
    description: "Open selected Task directory in your editor",
    hint: { keys: "o" },
  },
  {
    id: "tasks.renameBranch",
    scope: "sidebar",
    keys: ["b"],
    category: "Tasks pane",
    description: "Rename the selected task's git branch",
    hint: { keys: "b" },
  },
  {
    id: "tasks.cycleEngine",
    scope: "sidebar",
    keys: ["v"],
    category: "Tasks pane",
    description: "Cycle engine vendor — applies on reopen",
    hint: { keys: "v" },
  },
  {
    id: "tasks.update",
    scope: "sidebar",
    keys: ["u"],
    category: "Tasks pane",
    description: "Open the update page — version check + release notes",
    hint: { keys: "u" },
  },
  {
    // Right arrow = "go right into the conversation", inverse of ctrl+h.
    // Sidebar-scoped; the host gates it off during dialogs and `/`-search so
    // Right still moves the input cursor there.
    id: "tasks.focusEngine",
    scope: "sidebar",
    keys: ["right"],
    category: "Tasks pane",
    description: "Focus the engine pane of the current window",
    hint: { keys: "→" },
  },
]
