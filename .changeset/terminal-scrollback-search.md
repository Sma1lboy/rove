---
"@sma1lboy/rove": patch
---

Search the terminal scrollback. `ctrl+a` `/` opens a query row in the pane footer; typing filters live, `return`/`up` walk to older matches and `down` to newer ones, and `esc` closes the row and puts the viewport back where it was. Every hit on screen is highlighted, and the one you are parked on is painted in the accent colour. A new query parks on the newest occurrence, because a scrollback is read backwards.

The search covers Rove's own scrollback only: while a full-screen app is on the alternate screen it owns its buffer, and the row says so instead of walking one screen of somebody else's redraw.
