/**
 * `scope: "files"` rows, spread into `keybindings-table.ts`, which owns the
 * contract (stable `id`, spread order = display order, `hint` vs `keys`).
 */

import type { KobeBinding } from "./keybindings-table.ts"

export const FILES_BINDINGS: readonly KobeBinding[] = [
  {
    // POSITIONAL: alternating [down, up] pairs (slot dispatch).
    id: "files.nav",
    scope: "files",
    keys: ["j", "k", "down", "up"],
    category: "Files",
    description: "Move cursor up/down",
    hint: { keys: "j/k" },
  },
  {
    // l → expand / descend into first child / open file; h → collapse / jump
    // to parent. Plain letters are fine: files-scoped (docs/KEYBINDINGS.md).
    // POSITIONAL: alternating [collapse, expand] pairs (slot dispatch).
    id: "files.hierarchy",
    scope: "files",
    keys: ["h", "l", "left", "right"],
    category: "Files",
    description: "Collapse / expand tree level",
    hint: { keys: "h/l" },
  },
  {
    // Opens the configured TTY editor (nvim/vim: side-by-side diff vs HEAD when
    // changed). Resolution failure falls back to the read-only preview.
    id: "files.open",
    scope: "files",
    keys: ["return"],
    category: "Files",
    description: "Open file in configured editor (diff when supported)",
    hint: { keys: "enter" },
  },
  {
    // Brackets mean "adjacent tab" everywhere (cf. ctrl+[ / ctrl+]).
    // POSITIONAL: [previous tab, next tab] pairs (slot dispatch).
    id: "files.tab",
    scope: "files",
    keys: ["[", "]"],
    category: "Files",
    description: "Switch tab (cycle All / Changes)",
    hint: { keys: "[/]" },
  },
  {
    id: "files.refresh",
    scope: "files",
    keys: ["r"],
    category: "Files",
    description: "Refresh",
    hint: { keys: "r" },
  },
  {
    // Changes tab scope: working tree (uncommitted) ⇄ Branch (vs base).
    id: "files.scope",
    scope: "files",
    keys: ["b"],
    category: "Files",
    description: "Toggle Changes scope (working ↔ branch vs base)",
    hint: { keys: "b" },
  },
  {
    // Read-only diff in a workspace content tab, without stealing focus
    // (enter opens the editable editor instead).
    id: "files.diff",
    scope: "files",
    keys: ["d"],
    category: "Files",
    description: "Open read-only diff in a workspace tab",
    hint: { keys: "d" },
  },
  {
    // PROPOSED, awaiting owner sign-off (docs/design/keybinding-decisions.md).
    // The whole worktree's diff in one tab. Shadows nothing here, and the
    // header chip does the same job chord-free. `shift+d`, not `"D"`: matchKey
    // mints `shift+d`, so a bare uppercase key never matches.
    id: "files.diffAll",
    scope: "files",
    keys: ["shift+d"],
    category: "Files",
    description: "Open the whole worktree's diff in one workspace tab",
    hint: { keys: "D" },
  },
  {
    id: "files.openExternal",
    scope: "files",
    keys: ["o"],
    category: "Files",
    description: "Open file in system default app (audio / video / pdf preview)",
    hint: { keys: "o" },
  },
  {
    // Pastes `@<path>` into the engine composer WITHOUT submitting, so the
    // user keeps typing around it.
    id: "files.mention",
    scope: "files",
    keys: ["a"],
    category: "Files",
    description: "Inject @<path> mention into the engine pane",
    hint: { keys: "a" },
  },
  {
    // Sends the PR prompt into the engine pane. Prefix-only: a files-scoped
    // ctrl+p is unreachable from the sidebar (project filter) and the terminal
    // (passthrough). shift+p because "PR" reads uppercase. Registered by the
    // workspace host (host-keybindings.ts), so it fires from any pane.
    id: "files.createPR",
    scope: "global",
    keys: [],
    prefixKeys: ["p", "shift+p"],
    category: "Files",
    description: "Ask the agent to create a PR from the current task",
  },
  {
    // PROPOSED, awaiting owner sign-off (docs/design/keybinding-decisions.md).
    // Keyboard mirror of the row menu's "Fix failing checks". `k` is free
    // behind the prefix and sits beside `p`/`P`: same shape of action.
    id: "files.fixChecks",
    scope: "global",
    keys: [],
    prefixKeys: ["k"],
    category: "Files",
    description: "Ask the agent to fix the failing PR checks",
  },
  {
    // PROPOSED, awaiting owner sign-off (docs/design/keybinding-decisions.md).
    // Keyboard mirror of the row menu's "Sync with base"; `u` = "update from base".
    id: "files.syncBase",
    scope: "global",
    keys: [],
    prefixKeys: ["u"],
    category: "Files",
    description: "Merge the base branch into this task's worktree",
  },
  // ─── Diff review (read-only diff content tab) ─────────────────────────
  // Raw bindings registered by preview-review.tsx, live only in the diff tab
  // so they can't shadow input or terminals. `keys: []` rows exist so F1 lists them.
  {
    id: "diff.review.cursor",
    scope: "workspace",
    keys: [],
    category: "Diff review",
    description: "Move the line cursor over the diff",
    hint: { keys: "j/k" },
  },
  {
    id: "diff.review.range",
    scope: "workspace",
    keys: [],
    category: "Diff review",
    description: "Toggle range anchor at the cursor",
    hint: { keys: "v" },
  },
  {
    id: "diff.review.note",
    scope: "workspace",
    keys: [],
    category: "Diff review",
    description: "Add a review note at the cursor",
    hint: { keys: "c" },
  },
  {
    id: "diff.review.send",
    scope: "workspace",
    keys: [],
    category: "Diff review",
    description: "Send all unsent review notes to the engine",
    hint: { keys: "s" },
  },
  {
    // Registered in preview-review.tsx (`x`) and preview.tsx (`r`); rows here
    // so F1 matches the six keys the diff footer names.
    id: "diff.review.drop",
    scope: "workspace",
    keys: [],
    category: "Diff review",
    description: "Drop the review note the cursor sits inside",
    hint: { keys: "x" },
  },
  {
    // Registered by the preview itself, so it's live on image/binary previews
    // too, hence "file", not "diff".
    id: "diff.review.reload",
    scope: "workspace",
    keys: [],
    category: "Diff review",
    description: "Reload the previewed file from disk",
    hint: { keys: "r" },
  },
]
