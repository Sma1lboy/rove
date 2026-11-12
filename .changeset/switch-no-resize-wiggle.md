---
"@sma1lboy/rove": patch
---

Switching back to a task whose terminal is still running no longer resizes it by one row and back. The "Live process reattached" line now takes its row before the terminal is measured, so the shell is not asked to redraw twice on every switch.
