/**
 * state.json `worktree.deleteBranch`: deleting a managed task from the TUI also
 * deletes its local branch by `git branch -d` rules, so an unmerged branch
 * survives. Off unless the value is literally `true`. Read fresh per delete.
 */

import { loadStateFile } from "./store.ts"

export const WORKTREE_DELETE_BRANCH_KEY = "worktree.deleteBranch"

export function isDeleteBranchOnTaskDeleteEnabled(): boolean {
  return loadStateFile()[WORKTREE_DELETE_BRANCH_KEY] === true
}
