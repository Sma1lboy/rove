/**
 * What the tree sidebar's right-click menu offers on a given row.
 *
 * The rule that decides the list: **a row's menu is what that row's KEYBOARD
 * already does.** Nothing here is a new capability — every entry routes to a
 * callback the tree was already wired to, so the menu is a second route for
 * mouse users rather than a second set of rules to keep in sync. That is also
 * why a tab row lists the per-task verbs: the chords behave that way already
 * (`withCursorTask` walks up from a tab to its worktree, because rename /
 * delete have no tab-level meaning).
 *
 * `setStatus`, `copyBranch`, `copyPath` and `land` are the documented
 * exceptions, and they are SEQUENCING ones rather than a change of rule: a
 * chord is the owner's call (AGENTS.md, "Keybindings"), and until one is
 * agreed the menu is the only place a human can set a status the injected
 * agent protocol already tells every engine to write
 * (`engine/worktree-protocol.ts`), copy the row's branch / worktree path for
 * another shell, or land the row's branch without walking to the Worktrees
 * page. When a chord lands, the entry mirrors it like the rest.
 *
 * The new-conversation pair reads the same rule one pane over:
 * ctrl+e already opens the engine/shell picker for the task the
 * row points at, so the menu routes to THAT — the entry activates the row and
 * hands the request to its workspace, exactly like pressing the chord there.
 *
 * No Expand/Collapse entries anywhere: the tree has no fold — every level
 * always shows everything.
 *
 * Pure: labels are i18n KEYS, not text. The renderer runs them through `t()`
 * so the menu follows a language switch like everything else.
 */

import type { Task } from "@/types/task"
import type { TreeRow } from "./tree-core"

export type TreeMenuAction =
  | "open"
  | "forgetProject"
  | "fieldNotes"
  | "closeTab"
  | "newChat"
  | "newShell"
  | "newTask"
  | "rename"
  | "pin"
  | "reorder"
  | "runAgain"
  | "setStatus"
  | "copyBranch"
  | "copyPath"
  | "openEditor"
  | "renameBranch"
  | "changeEngine"
  | "fixChecks"
  | "land"
  | "delete"

export interface TreeMenuItem {
  readonly action: TreeMenuAction
  /** i18n key under `tasks.menu.*`. */
  readonly labelKey: string
  /** Destructive — the renderer paints it in the danger tone. */
  readonly danger?: boolean
}

export interface TreeMenuContext {
  /** How many tabs the row's worktree has. Closing the LAST one is allowed
   *  — the task keeps its row and re-opens on
   *  ⏎ / ctrl+e — so the entry shows for any tab that exists. */
  readonly tabCount?: number
}

/** Add-a-session verbs, shared by worktree and tab rows: the ctrl+e picker
 *  ("new conversation", which also offers shell/plugin panes) and the direct
 *  shell tab that picker's "shell" choice mints. */
function newTabVerbs(): TreeMenuItem[] {
  return [
    { action: "newChat", labelKey: "tasks.menu.newChat" },
    { action: "newShell", labelKey: "tasks.menu.newShell" },
  ]
}

/** The per-task verbs, shared by worktree and tab rows (see the module note
 *  on why a tab row carries them). Gated by the row's task kind: a `main` row
 *  is always pinned and `setPinned` silently no-ops on it (task-editor.ts),
 *  and an entry that does nothing is worse than no entry — the same rule
 *  `closeTab` follows above. */
function taskVerbs(task: Task): TreeMenuItem[] {
  const verbs: TreeMenuItem[] = [{ action: "rename", labelKey: "tasks.menu.rename" }]
  if (task.kind !== "main") {
    verbs.push({ action: "pin", labelKey: task.pinned === true ? "tasks.menu.unpin" : "tasks.menu.pin" })
  }
  verbs.push({ action: "reorder", labelKey: "tasks.menu.reorder" })
  // Re-fire the task's stored brief as a NEW task. Gated on the brief being
  // there: `prompt` is only recorded once a prompt was actually delivered, so
  // a task created without one has nothing to re-run — the same
  // "no entry beats a dead entry" rule `copyBranch` follows below.
  if (task.prompt !== undefined) verbs.push({ action: "runAgain", labelKey: "tasks.menu.runAgain" })
  // Status and the two copies are menu-only (no chord — a chord is the
  // owner's call, AGENTS.md "Keybindings"). Status had no route outside
  // `rove api set-status`; the copies put the two strings a row's identity is
  // made of on the clipboard, for a `git checkout` / `cd` in another shell.
  // None is danger-toned: they relabel or read, and touch nothing else.
  verbs.push({ action: "setStatus", labelKey: "tasks.menu.setStatus" })
  // Each copy shows only when its string is recorded — same rule as
  // `closeTab`. A `main`/`dir` row stores `branch === ""` (its label is the
  // live HEAD), and a task never entered stores BOTH as "" until
  // `ensureWorktree` allocates them (orchestrator/core.ts).
  if (task.branch !== "") verbs.push({ action: "copyBranch", labelKey: "tasks.menu.copyBranch" })
  if (task.worktreePath !== "") verbs.push({ action: "copyPath", labelKey: "tasks.menu.copyPath" })
  // `o` / `b` / `v` on the row, routed to the ROW's task (the chords read the
  // active task — see use-tree-menu.ts). `b` is gated exactly like
  // `copyBranch`: a `main`/`dir` row has no branch of its own to rename, and
  // `set-branch` refuses it, so the entry could only end in the error toast.
  verbs.push({ action: "openEditor", labelKey: "tasks.menu.openEditor" })
  if (task.branch !== "") verbs.push({ action: "renameBranch", labelKey: "tasks.menu.renameBranch" })
  verbs.push({ action: "changeEngine", labelKey: "tasks.menu.changeEngine" })
  // Pull the failing CI job's log into this task's engine. Gated on the PR
  // chip the row is ALREADY showing: with anything but `failing` there is no
  // log to fetch, and an entry that can only end in "nothing to report" is
  // worse than no entry (the same rule `copyBranch` follows above). Menu-only
  // until the proposed `ctrl+a k` chord is signed off
  // (docs/design/keybinding-decisions.md).
  if (task.prStatus?.checkState === "failing") {
    verbs.push({ action: "fixChecks", labelKey: "tasks.menu.fixChecks" })
  }
  // Menu-only, like `setStatus`: landing is the Worktrees page's `l`, and a
  // second chord for it is the owner's call
  // (docs/design/keybinding-decisions.md). Gated the same way `copyBranch`
  // is, plus the kind: `landTask` throws outright for a `main` or `dir` task
  // (neither owns a Rove-managed branch), and a task that never materialised
  // has no branch to land.
  if (task.kind === "task" && task.branch !== "") {
    verbs.push({ action: "land", labelKey: "tasks.menu.land" })
  }
  verbs.push({ action: "delete", labelKey: "tasks.menu.delete", danger: true })
  return verbs
}

export function treeMenuItems(row: TreeRow, ctx: TreeMenuContext = {}): TreeMenuItem[] {
  if (row.kind === "project") {
    // `d` on a project row already forgets it (task-actions.ts routes main
    // rows to `forgetProject` behind a confirm), so the menu carries the
    // entry too — this module's rule: a row's menu is what that
    // row's keyboard already does.
    // Field notes are menu-only, like `setStatus` (no chord). Agents file
    // them with `rove api note`.
    return [
      { action: "newTask", labelKey: "tasks.menu.newTask" },
      { action: "fieldNotes", labelKey: "tasks.menu.fieldNotes" },
      { action: "forgetProject", labelKey: "tasks.menu.forgetProject", danger: true },
    ]
  }
  if (row.kind === "worktree") {
    return [{ action: "open", labelKey: "tasks.menu.open" }, ...newTabVerbs(), ...taskVerbs(row.task)]
  }
  // The routine count row is a fold toggle, not a task — there is
  // no task for any verb here to act on, and an entry that does nothing is
  // worse than no entry (the same rule `closeTab` follows above).
  if (row.kind === "routines") return []
  const tabItems: TreeMenuItem[] = [{ action: "open", labelKey: "tasks.menu.openTab" }]
  if ((ctx.tabCount ?? 0) > 0) tabItems.push({ action: "closeTab", labelKey: "tasks.menu.closeTab" })
  return [...tabItems, ...newTabVerbs(), ...taskVerbs(row.task)]
}
