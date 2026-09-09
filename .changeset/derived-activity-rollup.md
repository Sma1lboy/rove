---
"@sma1lboy/rove": patch
---

A task's activity state now follows what its tabs are actually doing. It was a
separate copy updated last-event-wins across every tab, so on a task with more
than one tab a completion in one tab dimmed a live turn in another, and a tab
whose engine died or went quiet without being the last to report left the task
spinning with nothing running under it. The task state is now derived from the
per-tab ledger: any working tab means the task is working, otherwise the newest
state that wants a human (turn complete, permission needed, rate limited,
error, dead) shows through.

Closing a tab now clears its activity too — the running tab of a task could be
closed and leave the task row spinning for the life of the daemon.
