---
"@sma1lboy/rove": patch
---

Deleting a directory task that is not inside a git repository no longer writes an `issue-delete-unlink` error to the daemon log. Such a task has no Kanban card to unlink, so the daemon now skips the step.
