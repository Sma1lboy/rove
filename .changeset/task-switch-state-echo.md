---
"@sma1lboy/rove": patch
---

A task switch no longer re-renders the whole TUI twice when the daemon echoes its own state writes back: the shared state push leaves out the last-focused task id, and identical inbox visit echoes are adopted without a repaint. Changed visits from other windows still update an open Inbox.
