---
"@sma1lboy/rove": patch
---

Rove no longer runs `ps` every two seconds while your tabs sit quiet. The check for which engine runs in a tab now skips a tick when no tab printed anything since the last check, and still looks at least every 10 seconds.
