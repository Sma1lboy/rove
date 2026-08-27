---
"@sma1lboy/rove": patch
---

`land --delete-branch` now actually deletes the branch. git refuses to delete a branch a live worktree still has checked out, so passing `--delete-branch` without `--remove-worktree` used to silently do nothing — the failed `git branch -D` was swallowed. `--delete-branch` now implies removing the worktree first (branch and worktree drop together, matching the `delete` verb), and the branch is deleted only once that removal succeeds; a removal refused for a dirty worktree, the base checkout, or the caller's own worktree keeps the branch and lets the land stand.
