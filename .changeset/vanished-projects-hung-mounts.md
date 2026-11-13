---
"@sma1lboy/rove": patch
---

Checking whether a project's folder still exists no longer risks slowing the daemon when a network drive hangs. Each project is checked at most once every 30 seconds, a folder that answers slowly is left alone for 10 minutes, and no more than two checks wait at once, so a stuck mount cannot tie up the daemon's file access.
