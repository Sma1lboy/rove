---
"@sma1lboy/rove": patch
---

- Resuming a paused routine now waits for its next scheduled time. Before, the routine kept the next-run time it had when you paused it, so the first sweep after resuming logged every occurrence during the pause as `skipped_missed` and could still fire one that came due while it was paused.
