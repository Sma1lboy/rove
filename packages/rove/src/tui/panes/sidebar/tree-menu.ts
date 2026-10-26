/**
 * The tree sidebar's right-click menu per row.
 *
 * Rule: **a row's menu is what that row's KEYBOARD already does** — every
 * entry routes to an existing callback.
 *
 * Exceptions (`setStatus`, `copyId`, `copyBranch`, `copyPath`, `land`, `fieldNotes`,
 * `runAgain`, `moveToTop`, `toggleFold`, `resolveConflicts`) are menu-only until the owner agrees a chord (AGENTS.md,
 * "Keybindings"); then the entry mirrors it like the rest.
 *
 * "New chat" routes to the row's workspace ctrl+e picker, like pressing the
 * chord there. A task with children offers Collapse/Expand; projects don't
 * fold, and the routines row is toggled by opening it.
 *
 * Labels are i18n KEYS; the renderer runs them through `t()`.
 */

import { rollupPr } from "@/orchestrator/task-tree"
import type { Task } from "@/types/task"
import type { TreeRow } from "./tree-core"

export type TreeMenuAction =
  | "open"
  | "toggleFold"
  | "forgetProject"
  | "fieldNotes"
  | "newChat"
  | "newShell"
  | "newTask"
  | "rename"
  | "pin"
  | "reorder"
  | "moveToTop"
  | "runAgain"
  | "setStatus"
  | "copyId"
  | "copyBranch"
  | "copyPath"
  | "openEditor"
  | "renameBranch"
  | "changeEngine"
  | "fixChecks"
  | "rerunChecks"
  | "syncBase"
  | "resolveConflicts"
  | "land"
  | "delete"

export interface TreeMenuItem {
  readonly action: TreeMenuAction
  /** i18n key under `tasks.menu.*`. */
  readonly labelKey: string
  /** Destructive — the renderer paints it in the danger tone. */
  readonly danger?: boolean
  /**
   * Keymap row this entry mirrors; rendered via `legendCap`, so it shows the
   * current chord and nothing once unbound. Menu-only verbs carry no id.
   */
  readonly bindingId?: string
}

export interface TreeMenuContext {
  /** Project rows: it has a `main` checkout, the handle every project move goes through. */
  readonly projectMovable?: boolean
  /** Project rows: already the topmost movable project, so "Move to top" would be dead. */
  readonly projectFirst?: boolean
  /** Task rows: the worktree has a merge/rebase/cherry-pick/revert stopped on conflicts. */
  readonly operationPaused?: boolean
}

/** The ctrl+e picker, plus a direct shell tab (what the picker's "shell" choice mints). */
function newTabVerbs(): TreeMenuItem[] {
  return [
    { action: "newChat", labelKey: "tasks.menu.newChat", bindingId: "chat.tab.chooseEngine" },
    // No id: "shell" is a row inside the picker, not a chord.
    { action: "newShell", labelKey: "tasks.menu.newShell" },
  ]
}

/**
 * Per-task verbs for worktree and tab rows. Rule throughout: no entry beats a
 * dead entry — e.g. no pin on `main` (always pinned; `setPinned` no-ops).
 */
function taskVerbs(task: Task, ctx: TreeMenuContext): TreeMenuItem[] {
  const verbs: TreeMenuItem[] = [{ action: "rename", labelKey: "tasks.menu.rename", bindingId: "sidebar.rename" }]
  if (task.kind !== "main") {
    verbs.push({
      action: "pin",
      labelKey: task.pinned === true ? "tasks.menu.unpin" : "tasks.menu.pin",
      bindingId: "sidebar.pin",
    })
  }
  verbs.push({ action: "reorder", labelKey: "tasks.menu.reorder", bindingId: "sidebar.localMerge" })
  // Re-fire the stored brief as a NEW task; `prompt` is recorded only once
  // actually delivered.
  if (task.prompt !== undefined) verbs.push({ action: "runAgain", labelKey: "tasks.menu.runAgain" })
  // Otherwise status is only settable via `rove api update --status`. Not danger-toned.
  verbs.push({ action: "setStatus", labelKey: "tasks.menu.setStatus" })
  // The id `rove api ... --task-id` takes; recorded at creation, so always offered.
  verbs.push({ action: "copyId", labelKey: "tasks.menu.copyId" })
  // Copies need the string recorded: `main`/`dir` store `branch === ""`
  // (label is live HEAD), and a never-entered task stores both as "" until
  // `ensureWorktree` allocates them.
  if (task.branch !== "") verbs.push({ action: "copyBranch", labelKey: "tasks.menu.copyBranch" })
  if (task.worktreePath !== "") verbs.push({ action: "copyPath", labelKey: "tasks.menu.copyPath" })
  // `o` / `b` / `v`, routed to the ROW's task (the chords read the active
  // task; see use-tree-menu.ts). `b` gated like `copyBranch`: `update --branch`
  // refuses a `main`/`dir` row.
  verbs.push({ action: "openEditor", labelKey: "tasks.menu.openEditor", bindingId: "tasks.openWorktree" })
  if (task.branch !== "")
    verbs.push({ action: "renameBranch", labelKey: "tasks.menu.renameBranch", bindingId: "tasks.renameBranch" })
  verbs.push({ action: "changeEngine", labelKey: "tasks.menu.changeEngine", bindingId: "tasks.cycleEngine" })
  // Feed the failing CI log to the engine; only `failing` has a log. Chord
  // `ctrl+a k` is proposed, not signed off (docs/design/keybinding-decisions.md).
  // The rolled-up PR (any repo failing). The verbs act on the primary's PR number.
  if (rollupPr(task)?.checkState === "failing") {
    verbs.push({ action: "fixChecks", labelKey: "tasks.menu.fixChecks", bindingId: "files.fixChecks" })
    // Menu-only: for a red the user reads as flaky, not caused by the change.
    verbs.push({ action: "rerunChecks", labelKey: "tasks.menu.rerunChecks" })
  }
  // Merge base INTO the worktree (the `↓N` chip's action); gated like `land`.
  // Chord `ctrl+a u` is proposed, not signed off.
  if (task.kind === "task" && task.branch !== "") {
    verbs.push({ action: "syncBase", labelKey: "tasks.menu.syncBase", bindingId: "files.syncBase" })
  }
  // Menu-only: hand the paused operation's conflicts to the engine.
  if (ctx.operationPaused === true) verbs.push({ action: "resolveConflicts", labelKey: "tasks.menu.resolveConflicts" })
  // Menu-only (landing's chord is the Worktrees page `l`). `landTask` throws
  // for `main`/`dir`; an unmaterialised task has no branch.
  if (task.kind === "task" && task.branch !== "") {
    verbs.push({ action: "land", labelKey: "tasks.menu.land" })
  }
  // Say what goes: a `dir` task is a conversation in a folder the user owns.
  verbs.push({
    action: "delete",
    labelKey: task.kind === "dir" ? "tasks.menu.deleteConversation" : "tasks.menu.delete",
    danger: true,
    bindingId: "sidebar.delete",
  })
  return verbs
}

export function treeMenuItems(row: TreeRow, ctx: TreeMenuContext = {}): TreeMenuItem[] {
  if (row.kind === "project") {
    // `d` already forgets a project (behind a confirm). Field notes are
    // menu-only; agents file them with `rove api note`.
    const items: TreeMenuItem[] = [{ action: "newTask", labelKey: "tasks.menu.newTask", bindingId: "task.new" }]
    if (ctx.projectMovable) {
      if (!ctx.projectFirst) items.push({ action: "moveToTop", labelKey: "tasks.menu.moveToTop" })
      // Shift+M on the main row, which the menu puts the cursor on.
      items.push({ action: "reorder", labelKey: "tasks.menu.reorderProject", bindingId: "sidebar.localMerge" })
    }
    items.push(
      { action: "fieldNotes", labelKey: "tasks.menu.fieldNotes" },
      { action: "forgetProject", labelKey: "tasks.menu.forgetProject", danger: true, bindingId: "sidebar.delete" },
    )
    return items
  }
  if (row.kind === "worktree") {
    const items: TreeMenuItem[] = [{ action: "open", labelKey: "tasks.menu.open", bindingId: "sidebar.select" }]
    if (row.fold) {
      items.push({
        action: "toggleFold",
        labelKey: row.fold.collapsed ? "tasks.menu.expandChildren" : "tasks.menu.collapseChildren",
      })
    }
    return [...items, ...newTabVerbs(), ...taskVerbs(row.task, ctx)]
  }
  // Routines and "recent" rows have no task for any verb to act on.
  return []
}
