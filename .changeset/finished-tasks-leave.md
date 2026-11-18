---
"@sma1lboy/rove": patch
---

Tasks no client shows no longer pile up in `rove api list`. A routine that starts a new task per run now deletes that task when the run finishes (a `done` report, or nothing to report): the worktree goes, while the branch, the engine's conversation and the run's report in the routine's history stay, and uncommitted work is saved to a salvage ref first. A run that reported `partial`, `blocked` or `failed` keeps its task. A checkout cut with `add --worktree-only` is now archived, unarchived and deleted together with the session that cut it, even when it was not nested under that session; before, it stayed behind with its worktree and had no row to remove it from.
