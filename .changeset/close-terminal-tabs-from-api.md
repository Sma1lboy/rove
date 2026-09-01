---
"@sma1lboy/rove": patch
---

Add `rove api tab-close --task-id <id> --tab <tab-N>` to close an exact
Terminal Tab with or without an attached TUI. The command follows the normal
ctrl+w lifecycle, including hosted PTY cleanup and the empty-task result when
the last tab closes.
