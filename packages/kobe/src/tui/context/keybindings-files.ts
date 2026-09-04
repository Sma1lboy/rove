/**
 * `files.*` keybinding rows — the `scope: "files"` slice of the one binding
 * table, spread back into `keybindings-table.ts`.
 *
 * Same kind of cut as `keybindings-sidebar.ts` and `keybindings-chat.ts`:
 * a long array literal sliced at the scope headers it already carried as
 * comments. No responsibility boundary — which file a row lives in is
 * decided by its `scope` field and nothing else. See `keybindings-table.ts`
 * for the contract these rows must satisfy (stable `id`, spread order is
 * display order, `hint` vs `keys`).
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
    // `h`/`l` for hierarchy navigation in the All tab tree:
    //   l → expand directory / descend into first child / open file
    //   h → collapse directory / jump to parent
    // Plain letters are pane-scoped per the keybinding-boundaries
    // rule (docs/KEYBINDINGS.md): files-focused only, so they don't
    // collide with composer typing.
    // POSITIONAL: alternating [collapse, expand] pairs (slot dispatch).
    id: "files.hierarchy",
    scope: "files",
    keys: ["h", "l", "left", "right"],
    category: "Files",
    description: "Collapse / expand tree level",
    hint: { keys: "h/l" },
  },
  {
    // enter → one-key "just open it": opens the file in the configured TTY
    // editor. Nvim/Vim use a side-by-side diff vs HEAD when the file changed;
    // other editors open the file normally. Resolution failure falls back to
    // our own OpenTUI read-only preview.
    id: "files.open",
    scope: "files",
    keys: ["return"],
    category: "Files",
    description: "Open file in configured editor (diff when supported)",
    hint: { keys: "enter" },
  },
  {
    // `[` / `]` cycle the All / Changes tabs. A bracket pair, the same
    // shape as the `ctrl+[` / `ctrl+]` terminal-tab cycle one tier up —
    // brackets mean "adjacent tab" everywhere.
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
    // `b` → toggle the Changes tab between working-tree scope (uncommitted
    // work) and Branch scope (everything vs the base — the vs-base view).
    // Plain letter, files-scoped per the keybinding-boundaries rule.
    id: "files.scope",
    scope: "files",
    keys: ["b"],
    category: "Files",
    description: "Toggle Changes scope (working ↔ branch vs base)",
    hint: { keys: "b" },
  },
  {
    // `d` → open the current file's read-only diff in a workspace content
    // tab (a content swap, does not steal focus). Enter still opens
    // the editable editor tab; this is the non-focus-stealing diff view.
    id: "files.diff",
    scope: "files",
    keys: ["d"],
    category: "Files",
    description: "Open read-only diff in a workspace tab",
    hint: { keys: "d" },
  },
  {
    // PROPOSED, awaiting owner sign-off (docs/design/keybinding-decisions.md).
    // Shift+D → the whole worktree's diff in one tab: the "bigger d". Shadows
    // nothing in the Files table, and the header chip does the same job with
    // no chord at all, so the feature ships whatever the owner decides here.
    //
    // Spelled `shift+d`, not `"D"`: matchKey mints `shift+d` from Shift+D, so
    // a bare uppercase key never matches — the same rule `sidebar.localMerge`
    // records next door.
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
    // `a` → paste `@<path>` into the engine (claude/codex) pane's composer,
    // without submitting — the "add as a mention" action, so the user keeps
    // typing around it. Plain letter, files-scoped per
    // the keybinding-boundaries rule, so it can't collide elsewhere.
    id: "files.mention",
    scope: "files",
    keys: ["a"],
    category: "Files",
    description: "Inject @<path> mention into the engine pane",
    hint: { keys: "a" },
  },
  {
    // Ops-pane action on the Changes tab: sends the PR prompt into the
    // engine pane. prefix+p / prefix+P, no direct chord: a files-scoped
    // ctrl+p is unreachable from the sidebar (ctrl+p = project filter there)
    // and from the terminal (passes through to the engine). shift+p rides
    // along because "PR" reads uppercase: the capital press lands too.
    // Registered by the workspace host (host-keybindings.ts), not the
    // FileTree pane, so it fires from any pane focus.
    id: "files.createPR",
    scope: "global",
    keys: [],
    prefixKeys: ["p", "shift+p"],
    category: "Files",
    description: "Ask the agent to create a PR from the current task",
  },
  {
    // PROPOSED CHORD — awaiting owner sign-off
    // (docs/design/keybinding-decisions.md). The row menu's "Fix failing
    // checks" is the settled route; this mirrors it for the keyboard. `k` is
    // free behind the prefix (the bare `k` is the sidebar's cursor-up, which
    // the prefix does not reach) and sits next to the `p`/`P` create-PR pair
    // because they are the same shape of action: build a prompt about this
    // branch's PR and hand it to the engine.
    id: "files.fixChecks",
    scope: "global",
    keys: [],
    prefixKeys: ["k"],
    category: "Files",
    description: "Ask the agent to fix the failing PR checks",
  },
  {
    // PROPOSED CHORD — awaiting owner sign-off
    // (docs/design/keybinding-decisions.md). The row menu's "Sync with base"
    // is the settled route; this mirrors it for the keyboard. `u` is free
    // behind the prefix and reads as "update this branch from its base".
    id: "files.syncBase",
    scope: "global",
    keys: [],
    prefixKeys: ["u"],
    category: "Files",
    description: "Merge the base branch into this task's worktree",
  },
  // ─── Diff review (read-only diff content tab) ─────────────────────────
  // Plain letters, diff-tab-scoped raw bindings
  // (registered by preview-review.tsx like the preview's `o`), inert
  // everywhere else so they can't shadow input or embedded terminals.
  // Rows here are documentation-only (`keys: []`) so F1 lists them.
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
]
