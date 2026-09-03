---
"@sma1lboy/rove": patch
---

A tab that exits as the task's last one now comes back as the engine it was pinned to. Recycling used to hand back a bare first tab, so a tab you pointed at Codex respawned as the task's engine while still wearing the Codex conversation's title. It also reused `tab-1`, which let a recycled tab inherit a dead tab's Inbox episodes and its in-flight orphan suppression — ids are minted from the task's ordinal counter now, and are never reused. Separately, `ctrl+a` `w` closes the tab when there is no split, instead of being swallowed.
