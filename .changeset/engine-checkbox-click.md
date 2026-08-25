---
"@sma1lboy/rove": patch
---

Clicking an engine's on/off checkbox in Settings → Engines no longer also opens
its launch-command editor. The click bubbled to the row, so the checkbox fired
both actions at once; it now stops there and only toggles.
