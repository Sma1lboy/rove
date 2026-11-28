/**
 * A checkout cut with `add --worktree-only` is not a session: no client lists a row for it, parent or not, until an
 * engine starts a turn in it. `rove api list` and the Worktrees page still show it, so its worktree never goes missing.
 */
export function isUnlistedCheckout(task: { readonly worktreeOnly?: boolean }): boolean {
  return task.worktreeOnly === true
}
