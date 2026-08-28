---
"@sma1lboy/rove": patch
---

Fix the terminal selection drifting off its content on a plain shell tab. Once the pane's local scrollback saturates, every new line drops a row off the front of the snapshot, so the highlight slid downward relative to the text it selected. The selection now translates by the same absolute line id the viewport is already anchored to, and is dropped rather than mis-mapped when a resize reflows history.
