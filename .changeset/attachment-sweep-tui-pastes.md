---
"@sma1lboy/rove": patch
---

[tui][daemon] Images pasted into the TUI with ctrl+v are now cleaned out of `~/.rove/attachments/` after `attachments.keepDays`, as web and phone uploads already were; before, they were kept forever and the folder only grew.
