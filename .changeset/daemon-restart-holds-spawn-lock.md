---
"@sma1lboy/rove": patch
---

Refreshing Rove after an update now brings the daemon back on the build that asked. A restart stopped the daemon and left starting it again to whichever client reconnected first, so an older Rove still running (a desktop app left open, an old terminal) started its own older daemon, and the web's Refresh reported that the daemon did not come back on the new build. `rove daemon restart`, the TUI's refresh and the web's Refresh now hold the start lock from before the stop until the new daemon answers; other clients wait for it.
