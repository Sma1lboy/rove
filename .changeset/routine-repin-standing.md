---
"@sma1lboy/rove": patch
---

`rove api routine-update` can now change the vendor, model or effort of a persistent routine that already has a standing task. The routine lets go of that task (returned as `releasedSessionTaskId`, never stopped or deleted) and its next run builds a new one on the new settings, so the routine keeps its id, history and precheck.
