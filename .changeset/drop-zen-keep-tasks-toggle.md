---
"@sma1lboy/rove": patch
---

Settings → General drops the "Keep Tasks pane" switch, which changed nothing

The row wrote `zen.keepTasks` and no layout ever read it: zen keeps the Tasks rail unconditionally, because the rail carries the affordance for leaving zen. Its own hint had been reduced to "legacy — no layout effect today", which is a switch admitting in place that flipping it does nothing. The row and its plumbing are gone; a `zen.keepTasks` value left in an older `state.json` is ignored, as unknown keys always were.
