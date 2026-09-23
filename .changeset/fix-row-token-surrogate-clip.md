---
"@sma1lboy/rove": patch
---

A plugin's task-row label with an emoji or other astral character near the 24-character limit no longer shows a stray � in the sidebar: the label is now clipped on a whole-character boundary instead of a raw UTF-16 unit, so a surrogate pair straddling the cap is kept or dropped intact rather than sliced in half.
