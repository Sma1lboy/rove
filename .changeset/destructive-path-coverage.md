---
"@sma1lboy/rove": patch
---

Cover the destructive paths that could silently stop being guarded: deleting a
`dir` task on the daemon's `prepare → begin → finish` sequence (the path
`rove api delete` takes) never touches the user's own directory; `remove({
deleteBranch })` is asserted against real git rather than a mock, including the
`-d`/`-D` choice and the read-HEAD-before-removal ordering; `rove reset --hard`
still refuses without `--yes`; and a worktree rollback removes a dirty
directory instead of leaving debris behind.
