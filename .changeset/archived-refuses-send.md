---
"@sma1lboy/rove": patch
---

[cli] [daemon] [tui] `rove api send` to an archived task is refused with `TASK_ARCHIVED`: nothing is delivered, queued or started, whichever way the target was picked. Unarchive the task first. The PTY host also refuses to start a session under an archived task, so no client can bring one back by opening it.
