---
"@sma1lboy/rove": patch
---

A new shell is its own row: `tab-new --kind shell`, the TUI's New shell and the web's New shell open a child task sharing the directory whose `tab-1` is the login shell, so it shows in the rail and the TUI tree; its last shell exiting leaves the row empty (⏎ / Start opens a fresh shell) and never deletes it. The web's Ungrouped header gets a `+` (composer on No folder) and a right-click menu (New conversation (no folder), New shell), and the TUI's Scratch header gets the same menu. `rove api add --start` (no prompt) starts the task's engine idle in `tab-1` (`started: true`, `tabId`, `session`) instead of leaving a row with no tab, and a task with no tabs shows `Start <engine>` in the web and the TUI, which relaunches its own conversation.
