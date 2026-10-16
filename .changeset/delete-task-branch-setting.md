---
"@sma1lboy/rove": patch
---

Set `worktree.deleteBranch` to `true` in your config and deleting a task from the TUI also deletes its local git branch when that branch is merged, so finished work stops piling up in `git branch`; an unmerged branch, and the branch of a force-deleted dirty worktree, still stay.
