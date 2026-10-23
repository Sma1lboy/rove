---
"@sma1lboy/rove": patch
---

A task switch no longer re-renders the whole TUI twice when the daemon echoes its own state writes back: the shared state push leaves out the last-focused task id, and the inbox visit log is adopted without a repaint.
