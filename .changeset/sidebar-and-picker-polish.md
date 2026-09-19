---
"@sma1lboy/rove": patch
---

Four rail and dialog corrections from a round of use. An agent tab row in the sidebar is now two cells tall, the second naming the model and reasoning level that session launches with (`engine default` when neither is pinned) — the one fact that previously took opening a dialog to read. Shell, command and content tabs have no model, so they stay one cell and the rail only pays where the answer exists. The zen chip and the fold chevron now share the rail's last row instead of taking one each. In both the new-task dialog and the change-engine picker the model row moves above the reasoning level, and Tab walks them in that order. The rail's drag grip no longer tints under the cursor: it is a hit area, not a control, and it was repainting on every pointer motion across the rail's edge.
