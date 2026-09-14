---
"@sma1lboy/rove": patch
---

Fix a task's recent-engine-events feed dropping the wrong task once more than 100 tasks have reported activity in one daemon session. The in-memory feed keeps the 100 most recently active tasks and evicts the rest, but it picked the task whose FIRST event was oldest instead of the least-recently-active one — so a task you were still driving could have its feed silently emptied while long-idle tasks kept theirs. Eviction now tracks most-recent activity, so the task being appended to is never the one dropped.
