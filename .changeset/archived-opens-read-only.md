---
"@sma1lboy/rove": patch
---

[web] [ios] [tui] [daemon] Opening an archived session no longer starts its terminal again. The web shows the conversation read-only with an Unarchive button, the TUI shows "Archived — no live terminal" with an Unarchive button, and `rove api tab-revive` refuses an archived task with `TASK_ARCHIVED`.
