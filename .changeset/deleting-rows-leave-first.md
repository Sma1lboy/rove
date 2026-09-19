---
"@sma1lboy/rove": patch
---

A task you delete leaves the sidebar immediately, instead of sitting there spinning until the worktree teardown finishes. `rove api delete` was already asynchronous — the daemon accepts the request, writes `deletion.phase = "queued"` and publishes that snapshot before it starts destroying anything — but the sidebar kept rendering the row with a `deleting` caption for the whole removal. Now the row goes on the acceptance and the teardown runs behind it.

A deletion that fails puts the row back, and says why: the task returns with its `delete failed` caption and the daemon raises a toast naming the task and git's own reason (a locked worktree, a half-removed one), where before the reason only reached `daemon.log`. Refusals that never queue — a dirty worktree without `--force`, gitignored work, a project checkout — are unchanged and never hide the row.
