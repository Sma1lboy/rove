---
"@sma1lboy/rove": patch
---

`rove api add --count`/`--agents` now applies `--status` and `--pin` to every sibling it creates. Both flags previously validated, exited 0, and silently did nothing on a parallel round, so a fleet meant to land pinned and in review arrived unpinned in the backlog. The single and parallel paths now share one `applyPostCreateFlags` helper so they cannot drift apart again.
