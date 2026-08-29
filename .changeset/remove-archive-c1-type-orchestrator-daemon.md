---
"@sma1lboy/rove": patch
---

Remove the archive concept from the type layer, orchestrator, and daemon (issue #75 slice C1).

- `Task.archived`, `DaemonTask.archived`, and `SerializedTask.archived` are deprecated optional shims; `setArchived` is now a no-op.
- Store codec no longer reads or writes `archived`. Existing `tasks.json` files that still carry the field load without error; the field is silently dropped on the next save, while every other field is preserved.
- `done` is no longer auto-healed to `in_progress` on load, because archive is no longer a distinct state.
- Daemon collectors and pollers (worktree changes, transcript activity, PR status, auto-title, quota resume) no longer skip tasks based on `archived`.
- `worktree.archiveRemoved` and `task.archive` RPCs remain as deprecated no-ops so older clients do not see "unknown request" errors.
