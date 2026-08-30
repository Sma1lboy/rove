/**
 * Task-deletion audit trail.
 *
 * A task delete destroys a worktree and every tab under it, and until this
 * existed the daemon recorded a line ONLY when the removal FAILED
 * (`logDaemonError("task-deletion", …)`). A successful delete left no trace at
 * all, and no delete recorded WHO asked for it — so the owner-reported "a tab
 * I was working in vanished and it wasn't me" (2026-08-29) was only traceable
 * because that particular removal happened to fail. Deletes are the most
 * destructive thing an `rove api` caller can do to somebody else's session;
 * they get a record whether or not they succeed.
 *
 * The record goes to `daemon.log` via {@link logDaemonInfo}/{@link
 * logDaemonError}, not a separate file: it is already the place a user is
 * told to look (docs/TROUBLESHOOTING.md), `rove doctor --report` already
 * bundles its tail, and it is already size-capped + rotated. A second audit
 * file would be one more thing to find, rotate, and forget.
 *
 * One line per phase so a partial deletion is legible as such:
 *   requested → the RPC was accepted (carries the origin)
 *   salvaged  → a FORCED removal snapshotted uncommitted work first
 *   removed   → the worktree + index entry are gone
 *   failed    → the worktree removal threw; the task is retained in `error`
 */

import type { DaemonTask } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"

const SUBSYSTEM = "task-deletion-audit"

/**
 * Who asked for the delete. `dispatcher` is the deleted task's own recorded
 * spawner (`{taskId, tabId}`), which is the closest thing to provenance the
 * daemon holds: the daemon process has no caller env, and the RPC frame
 * carries only a connection id. `clientId` distinguishes concurrent callers
 * on the socket; the web transport passes its own.
 */
export interface DeletionOrigin {
  readonly clientId: number
  /**
   * The CLI caller's own VERIFIED Rove session (`rove api delete` from inside
   * an engine tab). Verified the way `send` verifies it — the bare
   * `$ROVE_TASK_ID` env inherits down the whole process tree and would name a
   * stranger's tab (issue #24) — so an unverifiable caller is absent here
   * rather than misattributed.
   */
  readonly requestedBy?: { readonly taskId: string; readonly tabId: string }
}

/** Render the caller-identifying half of an audit line. */
function originText(origin: DeletionOrigin | undefined, task: DaemonTask | undefined): string {
  const parts: string[] = []
  if (origin) parts.push(`client=${origin.clientId}`)
  if (origin?.requestedBy) parts.push(`by=${origin.requestedBy.taskId}::${origin.requestedBy.tabId}`)
  const dispatcher = task?.dispatcher
  // The dispatcher is the task's SPAWNER, not necessarily the deleter — but
  // when an agent deletes a task it created, it is the same session, and it is
  // the only durable identity the daemon can attribute. Labelled so a reader
  // never mistakes it for a verified deleter.
  if (dispatcher) parts.push(`spawnedBy=${dispatcher.taskId}::${dispatcher.tabId}`)
  return parts.length > 0 ? ` (${parts.join(" ")})` : ""
}

/** Render what is being destroyed, so the log is readable without tasks.json. */
function subjectText(task: DaemonTask | undefined, taskId: string): string {
  if (!task) return `task ${taskId}`
  const bits = [`task ${taskId}`, `title=${JSON.stringify(task.title)}`, `kind=${task.kind}`]
  if (task.branch) bits.push(`branch=${task.branch}`)
  if (task.worktreePath) bits.push(`worktree=${task.worktreePath}`)
  return bits.join(" ")
}

/** The RPC was accepted and queued — recorded BEFORE anything is destroyed. */
export function auditDeletionRequested(
  taskId: string,
  task: DaemonTask | undefined,
  origin: DeletionOrigin | undefined,
  opts: { force?: boolean; deleteBranch?: boolean } = {},
): void {
  logDaemonInfo(
    SUBSYSTEM,
    `requested ${subjectText(task, taskId)} force=${opts.force === true} deleteBranch=${opts.deleteBranch === true}${originText(origin, task)}`,
  )
}

/** The worktree and index entry are gone. */
export function auditDeletionRemoved(taskId: string, task: DaemonTask | undefined): void {
  logDaemonInfo(SUBSYSTEM, `removed ${subjectText(task, taskId)}`)
}

/**
 * The worktree removal threw. The task stays in `deletion.phase === "error"`,
 * but its session was already torn down and its Inbox/activity state cleared —
 * so this line also names what has ALREADY been undone, which is the half a
 * bare stack trace never told anyone.
 */
export function auditDeletionFailed(taskId: string, task: DaemonTask | undefined, err: unknown): void {
  // A real Error carrying the ORIGINAL error's stack. `logDaemonError` prints
  // `err.stack` and JSON-stringifies anything that is not an Error, so neither
  // a fresh `new Error(...)` (which stack-traces this helper and loses the
  // failing git call) nor a plain object (an unreadable blob) works here.
  const cause = err instanceof Error ? err : new Error(String(err))
  const context = `failed ${subjectText(task, taskId)} — session teardown and activity/inbox cleanup ALREADY ran; the worktree directory and task entry remain. Reason: `
  const line = new Error(`${context}${cause.message}`)
  line.name = cause.name
  const frames = cause.stack?.split("\n").slice(1) ?? []
  if (frames.length > 0) line.stack = [`${line.name}: ${line.message}`, ...frames].join("\n")
  logDaemonError(SUBSYSTEM, line)
}

/**
 * The recovery half of a salvage line: where the snapshot is and what to type.
 * A bare SHA leaves the last step as an exercise for somebody who has just
 * lost work, so the commands ship with it. `repo` scopes them with `-C` when
 * known (a task carries its repo; a bare worktree path does not).
 */
function recoveryText(ref: string, commit: string, repo?: string): string {
  const at = repo ? ` -C ${repo}` : ""
  return (
    `uncommitted work saved to ${ref} (${commit}). Recover with: ` +
    `git${at} show ${ref}  |  git${at} restore --source=${ref} -- <path>  |  ` +
    `list all: git${at} for-each-ref refs/rove/salvage`
  )
}

/**
 * A forced task deletion snapshotted the uncommitted work it was about to
 * destroy.
 *
 * Logged next to the `requested`/`removed` pair on purpose: someone who has
 * just noticed that work is gone knows the task title and roughly when, which
 * is exactly how this log reads. Finding the snapshot from a bare git ref
 * listing would instead require already knowing that it exists.
 */
export function auditDeletionSalvaged(taskId: string, ref: string, commit: string, repo?: string): void {
  logDaemonInfo(SUBSYSTEM, `salvaged task ${taskId} — ${recoveryText(ref, commit, repo)}`)
}

/**
 * A forced worktree removal outside the task lifecycle (worktrees page / web
 * DELETE) salvaged uncommitted work. Same subsystem as the task-deletion
 * lines: this is the same class of loss, and a user searching `daemon.log`
 * for their vanished work should not have to know which UI destroyed it.
 */
export function auditWorktreeSalvaged(worktreePath: string, ref: string, commit: string): void {
  logDaemonInfo(SUBSYSTEM, `salvaged worktree ${worktreePath} — ${recoveryText(ref, commit)}`)
}
