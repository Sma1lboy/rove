---
"@sma1lboy/rove": patch
---

An idle sidebar no longer repaints every two seconds. Rows still poll git on the same cadence, but the tree redraws only when a poll brings back a different branch or change count, and only rows showing an age label or an expiring plugin token tick on their own.
