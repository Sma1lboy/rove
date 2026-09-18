---
"@sma1lboy/rove": patch
---

Fold the task rail to a strip

The rail now folds away from a control in its bottom-right corner, leaving a three-column strip that keeps each task's `ctrl+<digit>` jump key tinted with that row's own state colour. The same control brings it back, and the fold survives a restart the way zen mode does.

The corner is the placement because the top-right corner is where the update chip lands, and a control parked there would compete with it exactly when an update is pending. The control is absolute, so the fold costs the rail no line.

Mouse only for now. A chord that does the same job is a separate decision.
