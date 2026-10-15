---
"@sma1lboy/rove": patch
---

Should-run: skip a tick the task can't use. `rove api should-run --task-id ID [--tab T]` answers `{run:true}` (exit 0) or a reason (exit 3: awaiting-owner, report-missing, quota, engine-error, engine-dead, awaiting-permission, busy). `send --if-runnable` checks, claims the tab and arms the delivery in one daemon step and records a skipped delivery when it refuses. Routines record a blocked firing as `skipped_blocked` instead of pasting into a busy or waiting task (a dead or errored bound tab is `dispatch_failed` and keeps the routine alarm), quota-resume no longer resumes a task awaiting its owner, and `get-task` / `collect` carry `runnability`. A `quota` skip always names its reset `until` and a delivery ended by a rate limit is not an unreported tick, so a rate-limited task resumes at the reset instead of staying blocked.

`rove api attention-dismiss --delivery ID` (and WeChat `clear d-N`) dismisses an unreported-tick row explicitly; opening or visiting a `report_missing` row no longer clears it.
