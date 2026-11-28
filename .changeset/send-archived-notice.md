---
"@sma1lboy/rove": patch
---

[cli] [daemon] `rove api send` targeting an archived task now returns `archived: true` and a one-line `warning` while still delivering, and gains `--unarchive` to restore the task and its archived descendants before delivering.
