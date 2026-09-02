---
"@sma1lboy/rove": patch
---

`rove api send` now measures a `succeeded:` report against the task's recorded base branch (`add --base-branch`), the same read `collect` makes. Before, a task cut from a branch ahead of `main` was measured against the `origin/main` guess, so an empty branch read as having commits and a hollow success reached the coordinator unrefused, only to be caught later by `land`. The opposite mistake, a false refusal when the worktree sat behind the guessed base, is gone too.
