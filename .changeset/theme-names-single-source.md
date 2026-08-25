---
"@sma1lboy/rove": patch
---

`rove theme list` now reads the bundled theme names from the map that owns the JSON
imports, instead of a hand-mirrored copy that could silently fall out of date.
