---
"@sma1lboy/rove": patch
---

Keep the input cursor stable on Windows when ConPTY briefly reports the Working or transcript row at the end of a synchronized update. Preserve the previous cursor only while its row is unchanged, keep text painting immediately, and allow genuine cursor moves to settle even when output stops.
