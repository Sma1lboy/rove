---
"@sma1lboy/rove": patch
---

A drag-selection on an engine tab now follows the content the app scrolls
under it, and the copy contains every line the highlight covered.

Engines run on the alternate screen: the snapshot is one screen, and the
edge-drag scroll is forwarded to the app as wheel ticks (`fedb8720`). The app
scrolled, the content moved, but the selection was addressed in snapshot rows
that never changed — so the highlight sat still as a screen-fixed rectangle
and rows scrolling in from the top never joined it. The pane now measures how
far the content actually moved between snapshots (the wheel only *asks* the
app to scroll, so the displacement is read back from the redraw, not assumed
from tick counts), moves the anchor with the content while the head stays
pinned to the pointer, and banks rows that scroll off screen in a bounded
per-drag buffer. Extraction runs over that composed buffer through the same
path the highlight's range feeds, so what you see selected is what mouse-up
copies — including the rows that already scrolled away.
