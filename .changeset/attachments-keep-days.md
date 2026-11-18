---
"@sma1lboy/rove": patch
---

Prompt attachments no longer pile up forever: the daemon deletes files in `~/.rove/attachments/` older than 30 days when it starts and once a day after. A file that a task's prompt, an issue or a routine still names is kept. Change the number of days with `attachments.keepDays` in `state.json`; `0` keeps everything.
