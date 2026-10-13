---
"@sma1lboy/rove": patch
---

Should-run: skip a tick the task can't use. `rove api should-run --task-id ID [--tab T]` answers `{run:true}` (exit 0) or a reason (exit 3: awaiting-owner, report-missing, quota, engine-error, engine-dead, awaiting-permission, busy). `send --if-runnable` checks, claims the tab and arms the delivery in one daemon step and records a skipped delivery when it refuses. Routines record a blocked firing as `skipped_blocked` instead of pasting into a busy or waiting task, quota-resume no longer resumes a task awaiting its owner, and `get-task` / `collect` carry `runnability`.
