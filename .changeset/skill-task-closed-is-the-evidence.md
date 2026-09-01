---
"@sma1lboy/rove": patch
---

Teach the agent skill that a dispatched task is finished only when it is gone.

A worker has no verb that removes itself, so "done" from a worker is a message, not a state change — its engine keeps running, its worktree keeps holding a branch, and its row stays in the sidebar. The skill covered closing a parallel round (land the winner, delete the losers) but said nothing about the ordinary case of one task doing one job, so a dispatcher would take the worker's report, or a merged PR, or an issue moved to `done`, as evidence the task had ended. None of those touch the task.

The skill now names the only evidence — `rove api list` no longer shows it — with the sweep for the other half, since tasks and worktrees drift apart: `delete` finds tasks by id, so a stray worktree is reachable only through git. It also warns about the case that makes this expensive rather than untidy: a worker holding `main` in its worktree blocks the dispatcher's own checkout, and a release cannot start until that task is closed.
