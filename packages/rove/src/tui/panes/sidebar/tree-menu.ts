/**
 * The tree sidebar's right-click menu per row.
 *
 * Rule: **a row's menu is what that row's KEYBOARD already does** — every
 * entry routes to an existing callback.
 *
 * Exceptions (`newTaskFromBranch`, `setStatus`, `copyId`, `copyBranch`, `copyPath`, `land`, `fieldNotes`,
 * `runAgain`, `moveToTop`, `toggleFold`, `resolveConflicts`, `muteNotifications`, `archive`) are menu-only until the owner agrees a chord (AGENTS.md,
 * "Keybindings"); then the entry mirrors it like the rest.
 *
 * "New chat" routes to the row's workspace ctrl+e picker, like pressing the
 * chord there. A task with children offers Collapse/Expand; projects don't
 * fold, and the routines row is toggled by opening it.
 *
 * Labels are i18n KEYS; the renderer runs them through `t()`.
 */

import { rollupPr } from "@sma1lboy/rove-core/orchestrator/task-tree.ts"
import { isRemoteRepoKey } from "@sma1lboy/rove-core/state/repos.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { workspaceCapabilities } from "@sma1lboy/rove-daemon/workspace"
import type { TreeRow } from "./tree-core"

export type TreeMenuAction =
  | "moveToProject"
  | "open"
  | "toggleFold"
  | "forgetProject"
  | "fieldNotes"
  | "newChat"
  | "newShell"
  | "continueEngine"
  | "newScratchChat"
  | "newScratchShell"
  | "newTask"
  | "newTaskFromBranch"
  | "rename"
  | "pin"
  | "reorder"
  | "moveToTop"
  | "moveProjectUp"
  | "moveProjectDown"
  | "runAgain"
  | "setStatus"
  | "muteNotifications"
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
  | "archive"
  | "delete"

/** The web menu's sections, in the order they sit: entries of one stay together, a rule falls where the section changes. */
export const TREE_MENU_SECTIONS = ["open", "edit", "git", "copy", "more", "danger"] as const
export type TreeMenuSection = (typeof TREE_MENU_SECTIONS)[number]

const SECTION_OF: Readonly<Record<TreeMenuAction, TreeMenuSection>> = {
  open: "open",
  newTask: "open",
  newScratchChat: "open",
  newScratchShell: "open",
  newChat: "open",
  newShell: "open",
  runAgain: "open",
  openEditor: "open",
  rename: "edit",
  pin: "edit",
  setStatus: "edit",
  moveToTop: "edit",
  moveProjectUp: "edit",
  moveProjectDown: "edit",
  fieldNotes: "edit",
  fixChecks: "git",
  syncBase: "git",
  resolveConflicts: "git",
  land: "git",
  copyId: "copy",
  copyBranch: "copy",
  copyPath: "copy",
  // Seldom used: the web tucks these into `More ›` rather than the top level.
  toggleFold: "more",
  continueEngine: "more",
  newTaskFromBranch: "more",
  reorder: "more",
  muteNotifications: "more",
  moveToProject: "more",
  renameBranch: "more",
  changeEngine: "more",
  rerunChecks: "more",
  archive: "danger",
  delete: "danger",
  forgetProject: "danger",
}

export function treeMenuSection(action: TreeMenuAction): TreeMenuSection {
  return SECTION_OF[action]
}

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
  /** Project rows: a project of this daemon, with the whole list on screen. */
  readonly projectMovable?: boolean
  /** Project rows: already the topmost (bottommost) movable project, so a move that way would be dead. */
  readonly projectFirst?: boolean
  readonly projectLast?: boolean
  /** Task rows: the worktree has a merge/rebase/cherry-pick/revert stopped on conflicts. */
  readonly operationPaused?: boolean
  /** Task rows: the task's toasts and chime are muted (`notifications.mutedTasks`). */
  readonly notificationsMuted?: boolean
  /** Project rows: the Scratch section header, which stands for no repo. */
  readonly scratchSection?: boolean
}

/** The ctrl+e picker, plus a direct shell tab (what the picker's "shell" choice mints). */
function newTabVerbs(): TreeMenuItem[] {
  return [
    { action: "newChat", labelKey: "tasks.menu.newChat", bindingId: "chat.tab.chooseEngine" },
    // No id: "shell" is a row inside the picker, not a chord.
    { action: "newShell", labelKey: "tasks.menu.newShell" },
    { action: "continueEngine", labelKey: "tasks.menu.continueEngine", bindingId: "chat.tab.fork" },
  ]
}

/**
 * A new task cut from this task's branch, so it stacks on the work in progress.
 * Single-repo, local, materialised managed tasks only: the base must resolve in this repo.
 */
function stackVerbs(task: Task): TreeMenuItem[] {
  const stackable =
    workspaceCapabilities(task).ownsBranch &&
    task.branch !== "" &&
    !task.sharesWorkspaceOf &&
    !task.extraRepos?.length &&
    (task.origin?.machineId ?? "local") === "local" &&
    !isRemoteRepoKey(task.repo)
  return stackable ? [{ action: "newTaskFromBranch", labelKey: "tasks.menu.newTaskFromBranch" }] : []
}

/** Rows `update --project` accepts: top-level, local, single-repo, not a routine session. */
function canMoveToProject(task: Task): boolean {
  return (
    !task.routine &&
    !task.parentTaskId &&
    !task.sharesWorkspaceOf &&
    !task.extraRepos?.length &&
    (task.origin?.machineId ?? "local") === "local" &&
    !isRemoteRepoKey(task.repo)
  )
}

/**
 * Per-task verbs for worktree and tab rows. Rule throughout: no entry beats a dead entry.
 */
function taskVerbs(task: Task, ctx: TreeMenuContext): TreeMenuItem[] {
  const verbs: TreeMenuItem[] = [{ action: "rename", labelKey: "tasks.menu.rename", bindingId: "sidebar.rename" }]
  verbs.push({
    action: "pin",
    labelKey: task.pinned === true ? "tasks.menu.unpin" : "tasks.menu.pin",
    bindingId: "sidebar.pin",
  })
  verbs.push({ action: "reorder", labelKey: "tasks.menu.reorder", bindingId: "sidebar.localMerge" })
  // Re-fire the stored brief as a NEW task; `prompt` is recorded only once
  // actually delivered.
  if (task.prompt !== undefined) verbs.push({ action: "runAgain", labelKey: "tasks.menu.runAgain" })
  // Otherwise status is only settable via `rove api update --status`. Not danger-toned.
  verbs.push({ action: "setStatus", labelKey: "tasks.menu.setStatus" })
  // Menu-only. A noisy task keeps its unread dot but stops toasting and ringing.
  verbs.push({
    action: "muteNotifications",
    labelKey: ctx.notificationsMuted === true ? "tasks.menu.unmuteNotifications" : "tasks.menu.muteNotifications",
  })
  // Menu-only. Top-level, local, single-repo rows only: the rest refuse (`rove api update --project`).
  if (canMoveToProject(task)) verbs.push({ action: "moveToProject", labelKey: "tasks.menu.moveToProject" })
  // The id `rove api ... --task-id` takes; recorded at creation, so always offered.
  verbs.push({ action: "copyId", labelKey: "tasks.menu.copyId" })
  // Copies need the string recorded: `dir` stores `branch === ""`
  // (label is live HEAD), and a never-entered task stores both as "" until
  // `ensureWorktree` allocates them.
  if (task.branch !== "") verbs.push({ action: "copyBranch", labelKey: "tasks.menu.copyBranch" })
  if (task.worktreePath !== "") verbs.push({ action: "copyPath", labelKey: "tasks.menu.copyPath" })
  // `o` / `b` / `v`, routed to the ROW's task (the chords read the active
  // task; see use-tree-menu.ts). `b` gated like `copyBranch`: `update --branch`
  // refuses a `dir` row.
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
  if (workspaceCapabilities(task).ownsBranch && task.branch !== "") {
    verbs.push({ action: "syncBase", labelKey: "tasks.menu.syncBase", bindingId: "files.syncBase" })
  }
  // Menu-only: hand the paused operation's conflicts to the engine.
  if (ctx.operationPaused === true) verbs.push({ action: "resolveConflicts", labelKey: "tasks.menu.resolveConflicts" })
  // Menu-only (landing's chord is the Worktrees page `l`). `landTask` throws
  // for `dir`; an unmaterialised task has no branch.
  if (workspaceCapabilities(task).ownsBranch && task.branch !== "") {
    verbs.push({ action: "land", labelKey: "tasks.menu.land" })
  }
  // Menu-only. Hides the row and its children.
  verbs.push({ action: "archive", labelKey: task.archived === true ? "tasks.menu.unarchive" : "tasks.menu.archive" })
  // Say what goes: a `dir` task is a conversation in a folder the user owns (Remove project lives on the
  // project header).
  verbs.push({
    action: "delete",
    labelKey: "tasks.menu.delete",
    danger: true,
    bindingId: "sidebar.delete",
  })
  return verbs
}

export function treeMenuItems(row: TreeRow, ctx: TreeMenuContext = {}): TreeMenuItem[] {
  if (row.kind === "project" && ctx.scratchSection === true) {
    // The Scratch section is no repo: only the two ways to start a task with no folder.
    return [
      { action: "newScratchChat", labelKey: "tasks.menu.newScratchChat" },
      { action: "newScratchShell", labelKey: "tasks.menu.newShell" },
    ]
  }
  if (row.kind === "project") {
    // Remove project and Field notes are menu-only; agents file notes with `rove api note`.
    const items: TreeMenuItem[] = [{ action: "newTask", labelKey: "tasks.menu.newTask", bindingId: "task.new" }]
    if (ctx.projectMovable) {
      if (!ctx.projectFirst) {
        items.push(
          { action: "moveToTop", labelKey: "tasks.menu.moveToTop" },
          { action: "moveProjectUp", labelKey: "tasks.menu.moveProjectUp" },
        )
      }
      if (!ctx.projectLast) items.push({ action: "moveProjectDown", labelKey: "tasks.menu.moveProjectDown" })
    }
    items.push(
      { action: "fieldNotes", labelKey: "tasks.menu.fieldNotes" },
      { action: "forgetProject", labelKey: "tasks.menu.forgetProject", danger: true },
    )
    return items
  }
  if (row.kind === "worktree") {
    // No "Open": a click on the row already does that.
    const items: TreeMenuItem[] = []
    if (row.fold) {
      items.push({
        action: "toggleFold",
        labelKey: row.fold.collapsed ? "tasks.menu.expandChildren" : "tasks.menu.collapseChildren",
      })
    }
    return [...items, ...newTabVerbs(), ...stackVerbs(row.task), ...taskVerbs(row.task, ctx)]
  }
  // Routines and "recent" rows have no task for any verb to act on.
  return []
}
