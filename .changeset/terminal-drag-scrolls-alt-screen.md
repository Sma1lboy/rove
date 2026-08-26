---
"@sma1lboy/rove": patch
---

Drag-selecting to the top or bottom edge of an ENGINE tab now scrolls. Claude
Code runs on the alternate screen, where the pane holds no local scrollback at
all, so the edge pull had nothing to move and the gesture looked dead. The pane
now scrolls a drag the same way it scrolls the wheel — an app that owns its own
scrollback gets wheel ticks forwarded, and only an app that wants neither moves
Rove's local viewport.
