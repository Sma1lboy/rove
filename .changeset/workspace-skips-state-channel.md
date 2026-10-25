---
"@sma1lboy/rove": patch
---

The TUI's main daemon connection no longer receives the shared-state push it never read, so each task switch sends one fewer copy of the shared state to the TUI.
