---
"@sma1lboy/rove": patch
---

A selection drag that leaves the terminal pane on its very first move — a fast
flick upward, or a press on the top row heading into the tab strip — now scrolls
the viewport into scrollback like the slower gesture already did. The pane
claims the drag on press instead of waiting for the renderer to hand it over on
the first drag event, which it only did when that event still landed inside the
pane.
