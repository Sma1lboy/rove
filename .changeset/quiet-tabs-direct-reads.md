---
"@sma1lboy/rove": patch
---

Keep sidebar process identity current when a hosted shell restarts with a new PID, and stop tab auto-naming from writing after its workspace unmounts. Simplify daemon state reads, share background tab lookup precedence, and avoid repeated scans while grouping unregistered tabs.
