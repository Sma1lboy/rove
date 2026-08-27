---
"@sma1lboy/rove": patch
---

Terminal selection now stays glued to its content after the mouse is released. In an engine tab, drag-selecting a region and then scrolling with the wheel left the highlight pinned to the same screen rows while the text moved out from under it; the content-following machinery was gated on a drag being in progress, so it stopped the moment the button came up. It is now gated on a selection existing, and both endpoints follow the content — the highlight travels off the top or bottom of the pane the way it does in every terminal emulator.
