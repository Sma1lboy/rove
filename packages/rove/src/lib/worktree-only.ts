/**
 * A checkout a session cut for itself with `add --worktree-only` is not a session: no client lists a row for it while
 * its parent is there to own it. Left without a parent it is listed, so its worktree never becomes invisible.
 */
export function isUnlistedCheckout(task: { readonly worktreeOnly?: boolean; readonly parentTaskId?: string }): boolean {
  return task.worktreeOnly === true && task.parentTaskId !== undefined
}
