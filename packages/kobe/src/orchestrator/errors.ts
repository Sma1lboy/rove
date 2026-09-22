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

/** Main tasks are bound to a saved repo entry, not a Rove-allocated worktree. */
export class CannotDeleteMainTaskError extends Error {
  constructor() {
    super("cannot delete a main task; remove the repo from saved repos instead")
    this.name = "CannotDeleteMainTaskError"
  }
}

/**
 * Stable sentinel in {@link DirtyWorktreeError}'s message. The daemon RPC layer
 * rebuilds errors as `new Error(message)` (`name` does NOT survive the wire),
 * so remote callers match `err.message.includes(...)`.
 */
export const DIRTY_WORKTREE_CODE = "DIRTY_WORKTREE"

/**
 * Thrown when deleting a task whose worktree has uncommitted / untracked
 * changes without `force`; the UI matches {@link DIRTY_WORKTREE_CODE} and
 * re-prompts for force-delete.
 *
 * `ignored` names the gitignored paths behind the refusal — `git status` can't
 * see them, so the paths are the only way the refusal is actionable.
 * `"unknown"` means the ignored listing did not run; it refuses through the
 * SAME error on purpose, since a force re-prompt is exactly what an
 * unverifiable worktree needs.
 *
 * {@link describeDirtyWorktreeWork} is shared with `GitWorktreeManager.remove`'s
 * refusals — remote callers see only the message either way.
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

/** `git worktree remove` failed (locked, permission, corrupt git-dir); the index
 *  entry is kept so the orphan stays visible and re-deletable. */
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

/** Wire sentinel — same reason as {@link DIRTY_WORKTREE_CODE}. */
const MAIN_CHECKOUT_DIRTY_CODE = "MAIN_CHECKOUT_DIRTY"

/**
 * `landTask` merges INTO the base checkout, so a dirty one would entangle the
 * user's work with the landed branch. Never `git stash` instead: the stash
 * stack is shared by every linked worktree of the repo.
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

/** Wire sentinel — same reason as {@link DIRTY_WORKTREE_CODE}. */
export const EMPTY_BRANCH_CODE = "EMPTY_BRANCH"

/** Zero commits ahead of base and a clean (or gone) worktree — the shape of
 *  "worker reported success but delivered nothing", so refuse loudly. */
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

export const EMPTY_BRANCH_DIRTY_WORKTREE_CODE = "EMPTY_BRANCH_DIRTY_WORKTREE"

/** Zero commits ahead of base but uncommitted files in the worktree: landing
 *  would silently drop work that was written but never committed. */
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

/** Wire sentinel — same reason as {@link DIRTY_WORKTREE_CODE}. */
export const MISSING_REF_CODE = "MISSING_REF"

/**
 * `<base>..<branch>` does not resolve (branch renamed or deleted outside Rove),
 * so `git rev-list --count` exits non-zero. Unlike {@link EmptyBranchError}
 * ("git counted zero"), this is a broken task record.
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

/** Wire sentinel — same reason as {@link DIRTY_WORKTREE_CODE}; the file list rides in the message. */
const LAND_CONFLICT_CODE = "LAND_CONFLICT"

/** The merge is aborted before the throw, so the base checkout is untouched. */
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

/** Wire sentinel — same reason as {@link DIRTY_WORKTREE_CODE}. */
export const GIT_COMMAND_FAILED_CODE = "GIT_COMMAND_FAILED"

/**
 * A land git command failed for a reason Rove has no policy for (a
 * `pre-commit`/`commit-msg` hook, a broken `commit.gpgsign` key, an unset
 * `user.email`). Surfaces git's stderr rather than misreading the failure as
 * "empty branch" or a {@link LandConflictError} with no files.
 *
 * `hint` names what the caller can still do — for squash, that the staged
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

const WORKTREE_NAME_TAKEN_CODE = "WORKTREE_NAME_TAKEN"

/**
 * `add --worktree-name` names a directory already in use (live task, dir on
 * disk, or a concurrent create not yet persisted). An ERROR, not a `-v2`
 * suffix: an explicit name exists so the caller can predict the path.
 */
export class WorktreeNameTakenError extends Error {
  constructor(public readonly worktreeName: string) {
    super(
      `${WORKTREE_NAME_TAKEN_CODE}: worktree name '${worktreeName}' is already in use in this repo — pick another, or omit --worktree-name for a generated one`,
    )
    this.name = "WorktreeNameTakenError"
  }
}

const INVALID_WORKTREE_NAME_CODE = "INVALID_WORKTREE_NAME"

/** `add --worktree-name` must be one path segment: a separator or `..` would put
 *  the checkout outside the root every cleanup path is scoped to. */
export class InvalidWorktreeNameError extends Error {
  constructor(public readonly worktreeName: string) {
    super(
      `${INVALID_WORKTREE_NAME_CODE}: worktree name '${worktreeName}' must be a single path segment of letters, digits, '.', '_' or '-' (no '/', no '..', not starting with '.')`,
    )
    this.name = "InvalidWorktreeNameError"
  }
}
