---
"@sma1lboy/rove": patch
---

Terminal drag-select now scrolls from the pane's edge ROW, not only from
beyond it — the pane sits flush under the tab strip, so holding the drag on
the first visible row (the actual gesture) previously did nothing. The pull is
directional, so a sideways drag along that row still doesn't move the
viewport, and the selection anchor is read from a ref so the first drag event
after mouse-down isn't judged against a stale anchor.
