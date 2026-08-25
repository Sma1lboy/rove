---
"@sma1lboy/rove": patch
---

Terminal selection can now reach scrollback: dragging past the pane's top or
bottom edge scrolls the viewport and keeps extending the selection, instead of
pinning it to the first visible row. The pane's snapshot no longer registers as
opentui-selectable either — that was swallowing every drag event once the
pointer left the pane, so the drag could never be followed past the edge.
