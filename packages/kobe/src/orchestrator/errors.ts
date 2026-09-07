import { errorMessage } from "@/lib/error-message"
import type { TaskStatus } from "../types/task.ts"

/** Thrown when a state-machine transition is illegal. */
export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: TaskStatus,
    public readonly to: TaskStatus,
    public readonly taskId: string,
  ) {
    super(`illegal transition for task ${taskId}: ${from} -> ${to}`)
    this.name = "IllegalTransitionError"
  }
}

/** Thrown when a task id cannot be resolved. */
export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`task not found: ${taskId}`)
    this.name = "TaskNotFoundError"
  }
}

/**
 * Thrown when a caller tries to delete a task with `kind: "main"`.
 * Main tasks are bound to a saved repo entry, not a kobe-allocated worktree.
 */
export class CannotDeleteMainTaskError extends Error {
  constructor() {
    super("cannot delete a main task; remove the repo from saved repos instead")
    this.name = "CannotDeleteMainTaskError"
  }
}

/**
 * Stable sentinel embedded in {@link DirtyWorktreeError}'s message.
 *
 * The daemon RPC layer reconstructs a thrown error as `new Error(message)`
 * (the `name` field does NOT survive the wire), so a caller across the
 * daemon boundary can only discriminate on the MESSAGE. This code is that
 * machine-stable marker — match it with `err.message.includes(...)`.
 */
export const DIRTY_WORKTREE_CODE = "DIRTY_WORKTREE"

/**
 * Thrown when deleting a task whose worktree has uncommitted / untracked
 * changes and `force` was not requested. The UI catches it (via
 * {@link DIRTY_WORKTREE_CODE}) and re-prompts for explicit force-delete
 * confirmation rather than silently destroying the work.
 *
 * `ignored` names the gitignored paths that triggered the refusal, when that
 * is what did. `git status` cannot see those, so a user told only "uncommitted
 * or untracked changes" would go looking with a command that reports nothing
 * — the paths are the only way that refusal is actionable.
 *
 * `"unknown"` is the third answer: the ignored listing did not run, so nothing
 * can say whether this worktree holds such work. It refuses through the SAME
 * error on purpose — the UI already turns this one into a force-delete
 * re-prompt, which is exactly the choice an unverifiable worktree needs.
 *
 * The sentence itself is {@link describeDirtyWorktreeWork}, shared with
 * `GitWorktreeManager.remove`'s own refusals — the same three states, and a
 * caller across the daemon boundary sees only the message either way.
 */
export function describeDirtyWorktreeWork(ignored: readonly string[] | "unknown"): string {
  return ignored === "unknown"
    ? "gitignored work this check could not read (git status --ignored failed) — nothing here can confirm it is empty"
    : ignored.length > 0
      ? `gitignored work git status cannot see: ${ignored.join(", ")}`
      : "uncommitted or untracked changes"
}

export class DirtyWorktreeError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly ignored: readonly string[] | "unknown" = [],
  ) {
    super(`${DIRTY_WORKTREE_CODE}: task ${taskId} worktree has ${describeDirtyWorktreeWork(ignored)}`)
    this.name = "DirtyWorktreeError"
  }
}

/**
 * Thrown when `git worktree remove` itself failed (locked, permission,
 * corrupt git-dir). The orchestrator keeps the task index entry in this
 * case so the orphaned worktree stays visible + re-deletable instead of
 * becoming invisible on-disk debris.
 */
export class WorktreeRemoveFailedError extends Error {
  constructor(
    public readonly taskId: string,
    public override readonly cause: unknown,
  ) {
    super(`failed to remove worktree for task ${taskId}: ${errorMessage(cause)}`)
    this.name = "WorktreeRemoveFailedError"
  }
}

/** Stable wire-visible marker for attempts to reactivate a deleting task. */
export const TASK_DELETING_CODE = "TASK_DELETING"

export class TaskDeletingError extends Error {
  constructor(public readonly taskId: string) {
    super(`${TASK_DELETING_CODE}: task ${taskId} is being deleted`)
    this.name = "TaskDeletingError"
  }
}

/**
 * Stable sentinel embedded in {@link MainCheckoutDirtyError}'s message — the
 * `name` field doesn't survive the daemon wire, so a caller across the boundary
 * discriminates on the MESSAGE (`err.message.includes(MAIN_CHECKOUT_DIRTY_CODE)`).
 */
const MAIN_CHECKOUT_DIRTY_CODE = "MAIN_CHECKOUT_DIRTY"

/**
 * Thrown by `landTask` when the base repo's checkout has uncommitted changes.
 * Landing merges the task branch INTO that checkout, so a dirty tree would
 * entangle the user's in-progress work with the landed branch — we refuse and
 * let them commit first. (Never `git stash` here: the stash stack lives in
 * the repo's common dir and is shared by every linked worktree, so a stash in
 * the base checkout can entangle parallel tasks' work.)
 */
export class MainCheckoutDirtyError extends Error {
  constructor(
    public readonly repo: string,
    public readonly dir: string,
  ) {
    super(
      `${MAIN_CHECKOUT_DIRTY_CODE}: base checkout at ${dir} has uncommitted changes; commit them before landing (never git stash — the stash stack is shared by every worktree of this repo)`,
    )
    this.name = "MainCheckoutDirtyError"
  }
}

/**
 * Stable sentinel embedded in {@link EmptyBranchError}'s message — same
 * wire-boundary reason as {@link DIRTY_WORKTREE_CODE}.
 */
export const EMPTY_BRANCH_CODE = "EMPTY_BRANCH"

/**
 * Thrown by `landTask` when the task branch has ZERO commits ahead of the base
 * branch and its worktree is clean (or gone). Merging it would be a no-op —
 * the classic shape of "worker reported success but delivered nothing" — so we
 * refuse loudly instead of landing an empty merge into main.
 */
export class EmptyBranchError extends Error {
  constructor(
    public readonly branch: string,
    public readonly landedOn: string,
  ) {
    super(
      `${EMPTY_BRANCH_CODE}: '${branch}' has no commits ahead of '${landedOn}' — landing it would be a no-op (the worker may not have delivered anything)`,
    )
    this.name = "EmptyBranchError"
  }
}

/**
 * Stable sentinel embedded in {@link EmptyBranchDirtyWorktreeError}'s message.
 */
export const EMPTY_BRANCH_DIRTY_WORKTREE_CODE = "EMPTY_BRANCH_DIRTY_WORKTREE"

/**
 * Thrown by `landTask` when the task branch has ZERO commits ahead of the base
 * branch AND its worktree still has uncommitted/untracked files: the work was
 * written but never committed, so landing would silently drop it. The file
 * list rides in the message; the hint points at committing in the worktree.
 */
export class EmptyBranchDirtyWorktreeError extends Error {
  constructor(
    public readonly branch: string,
    public readonly landedOn: string,
    public readonly worktreePath: string,
    public readonly files: readonly string[],
  ) {
    const list = files.length > 0 ? files.join(", ") : "(none reported)"
    super(
      `${EMPTY_BRANCH_DIRTY_WORKTREE_CODE}: '${branch}' has no commits ahead of '${landedOn}' but its worktree ${worktreePath} has uncommitted changes (${list}) — commit them in the worktree first, then land again`,
    )
    this.name = "EmptyBranchDirtyWorktreeError"
  }
}

/**
 * Stable sentinel embedded in {@link MissingRefError}'s message — same
 * wire-boundary reason as {@link DIRTY_WORKTREE_CODE}.
 */
export const MISSING_REF_CODE = "MISSING_REF"

/**
 * Thrown by `landTask` when git cannot resolve the `<base>..<branch>` range at
 * all — the recorded branch was renamed or deleted outside Rove, so
 * `git rev-list --count` exits non-zero instead of printing a number. Distinct
 * from {@link EmptyBranchError}: that one means "git counted, and the answer
 * was zero"; this one means "git could not count", which is a broken task
 * record, not an empty branch.
 */
export class MissingRefError extends Error {
  constructor(
    public readonly branch: string,
    public readonly landedOn: string,
    public readonly dir: string,
  ) {
    super(
      `${MISSING_REF_CODE}: '${branch}' does not resolve in the base repo at ${dir} (comparing against '${landedOn}') — the branch was renamed or deleted outside Rove; re-point the task with \`rove api set-branch\` or recreate the branch`,
    )
    this.name = "MissingRefError"
  }
}

/**
 * Stable sentinel embedded in {@link LandConflictError}'s message — same
 * wire-boundary reason as {@link DIRTY_WORKTREE_CODE}. The conflicted-file list
 * rides along in the message so a CLI/TUI caller can print it after matching.
 */
const LAND_CONFLICT_CODE = "LAND_CONFLICT"

/**
 * Thrown by `landTask` when the merge hit conflicts. The merge is aborted
 * before the throw, so the base checkout is left untouched; the conflicted
 * paths are carried so the caller can show the human what to resolve.
 */
export class LandConflictError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly branch: string,
    public readonly files: readonly string[],
  ) {
    const list = files.length > 0 ? files.join(", ") : "(none reported)"
    super(`${LAND_CONFLICT_CODE}: merging '${branch}' hit conflicts, merge aborted — conflicted files: ${list}`)
    this.name = "LandConflictError"
  }
}

/**
 * Stable sentinel embedded in {@link GitCommandFailedError}'s message — same
 * wire-boundary reason as {@link DIRTY_WORKTREE_CODE}.
 */
export const GIT_COMMAND_FAILED_CODE = "GIT_COMMAND_FAILED"

/**
 * Thrown by `landTask` when a git command failed for a reason Rove has no
 * policy for — a `pre-commit`/`commit-msg` hook, a broken `commit.gpgsign`
 * key, an unset `user.email`.
 *
 * It exists because the alternative is a LIE. Both land strategies used to
 * read a failed commit as the one benign cause they knew: squash reported
 * "already merged or empty" about a branch that had staged cleanly (and then
 * `reset --hard` threw the squash away), and merge threw the phantom
 * {@link LandConflictError} with an empty file list that
 * `assertBranchHasWork`'s docstring says it exists to prevent. Neither ever
 * looked at git's stderr, which said exactly what was wrong.
 *
 * The `hint` names what the caller can still do — for squash, that the staged
 * merge is deliberately left in place to be committed by hand.
 */
export class GitCommandFailedError extends Error {
  constructor(
    public readonly command: string,
    public readonly stderr: string,
    hint?: string,
  ) {
    const detail = stderr.trim() || "(git printed nothing on stderr)"
    super(`${GIT_COMMAND_FAILED_CODE}: \`git ${command}\` failed — ${detail}${hint ? `; ${hint}` : ""}`)
    this.name = "GitCommandFailedError"
  }
}
