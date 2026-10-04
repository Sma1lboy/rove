/**
 * Task-deletion audit trail: every delete (the most destructive thing an
 * `rove api` caller can do to someone else's session) is recorded with WHO
 * asked, whether or not it succeeds.
 *
 * Goes to `daemon.log` via {@link logDaemonInfo}/{@link logDaemonError}, not
 * a separate file: it's where TROUBLESHOOTING points users, `rove doctor
 * --report` bundles its tail, and it's already size-capped + rotated.
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
 * Who asked for the delete. The daemon has no caller env and the RPC frame
 * carries only a connection id; `clientId` distinguishes concurrent callers
 * (the web transport passes its own).
 */
export interface DeletionOrigin {
  readonly clientId: number
  /**
   * The CLI caller's VERIFIED Rove session, verified like `send` does: bare
   * `$ROVE_TASK_ID` inherits down the process tree and could name a
   * stranger's tab, so an unverifiable caller is absent, not misattributed.
   */
  readonly requestedBy?: { readonly taskId: string; readonly tabId: string }
}

/** Render the caller-identifying half of an audit line. */
function originText(origin: DeletionOrigin | undefined, task: DaemonTask | undefined): string {
  const parts: string[] = []
  if (origin) parts.push(`client=${origin.clientId}`)
  if (origin?.requestedBy) parts.push(`by=${origin.requestedBy.taskId}::${origin.requestedBy.tabId}`)
  const dispatcher = task?.dispatcher
  // The SPAWNER, not necessarily the deleter, but the only durable identity
  // the daemon holds. Labelled so nobody reads it as a verified deleter.
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
 * `--delete-branch` was asked for and git refused. Logged BEFORE `removed`,
 * which names the branch and would otherwise read as confirmation it went.
 * Info, not error: git refusing an unmerged branch is protecting work.
 */
export function auditDeletionBranchKept(taskId: string, branch: string, reason: string): void {
  logDaemonInfo(
    SUBSYSTEM,
    `branch kept task ${taskId} branch=${branch} — git refused the delete: ${reason.replace(/\s+/g, " ").trim()}. Nothing else will remove it; \`git branch -D ${branch}\` does, and drops its reflog with it.`,
  )
}

/**
 * The worktree removal threw. The task stays in `deletion.phase === "error"`;
 * the line also names what was ALREADY undone (session, Inbox/activity).
 */
export function auditDeletionFailed(taskId: string, task: DaemonTask | undefined, err: unknown): void {
  // A real Error carrying the ORIGINAL stack: `logDaemonError` prints
  // `err.stack` and JSON-stringifies non-Errors, so a fresh Error would trace
  // this helper and a plain object would be an unreadable blob.
  const cause = err instanceof Error ? err : new Error(String(err))
  const context = `failed ${subjectText(task, taskId)} — session teardown and activity/inbox cleanup ALREADY ran; the worktree directory and task entry remain. Reason: `
  const line = new Error(`${context}${cause.message}`)
  line.name = cause.name
  const frames = cause.stack?.split("\n").slice(1) ?? []
  if (frames.length > 0) line.stack = [`${line.name}: ${line.message}`, ...frames].join("\n")
  logDaemonError(SUBSYSTEM, line)
}

/**
 * The recovery half of a salvage line: where the snapshot is and the commands
 * to get it back. `repo` scopes them with `-C` when known.
 */
function recoveryText(ref: string, commit: string, repo?: string, uncaptured: readonly string[] = []): string {
  const at = repo ? ` -C ${repo}` : ""
  // Submodules / nested worktrees are `160000` gitlinks (a SHA, not files), so
  // `git restore --source` silently produces nothing there — name them.
  const gap =
    uncaptured.length > 0
      ? ` NOT captured (submodule / nested worktree — the snapshot holds only a commit pointer): ${uncaptured.join(", ")}.`
      : ""
  return (
    `uncommitted work saved to ${ref} (${commit}).${gap} Recover with: ` +
    `git${at} show ${ref}  |  git${at} restore --source=${ref} -- <path>  |  ` +
    `list all: git${at} for-each-ref refs/rove/salvage`
  )
}

/**
 * A forced task deletion snapshotted the uncommitted work it was about to
 * destroy. Logged beside `requested`/`removed` so someone who knows only the
 * task title and rough time can find it.
 */
export function auditDeletionSalvaged(
  taskId: string,
  ref: string,
  commit: string,
  repo?: string,
  uncaptured: readonly string[] = [],
): void {
  logDaemonInfo(SUBSYSTEM, `salvaged task ${taskId} — ${recoveryText(ref, commit, repo, uncaptured)}`)
}

/**
 * A forced worktree removal outside the task lifecycle (worktrees page / web
 * DELETE) salvaged uncommitted work. Same subsystem so a user searching
 * `daemon.log` needn't know which UI destroyed it.
 */
export function auditWorktreeSalvaged(
  worktreePath: string,
  ref: string,
  commit: string,
  uncaptured: readonly string[] = [],
): void {
  logDaemonInfo(SUBSYSTEM, `salvaged worktree ${worktreePath} — ${recoveryText(ref, commit, undefined, uncaptured)}`)
}

/**
 * A deletion's `git worktree remove` deregistered the worktree but could not
 * delete its directory (usually an unwritable path inside it). Info, not
 * error: the deletion completed. This line is the only record of the leftover
 * path; Rove won't remove it, since whatever blocked deletion may be wanted.
 */
export function auditDeletionResidue(taskId: string, worktreePath: string, reason: string): void {
  const advice = "Nothing further is needed in Rove; remove the directory by hand if you want the disk space."
  logDaemonInfo(
    SUBSYSTEM,
    `removed task ${taskId} — git deregistered the worktree but could NOT delete ${worktreePath} (${reason}). ${advice}`,
  )
}

/**
 * A worktree removal outside the task lifecycle (worktrees page / web DELETE)
 * deregistered the worktree but could not delete its directory. Same
 * subsystem, same reason as {@link auditWorktreeSalvaged}.
 */
export function auditWorktreeResidue(worktreePath: string, reason: string): void {
  logDaemonInfo(SUBSYSTEM, `deregistered ${worktreePath} but could NOT delete the directory (${reason})`)
}
