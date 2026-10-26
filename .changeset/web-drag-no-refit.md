---
"@sma1lboy/rove": patch
---

Web: dragging the rail or the side panel no longer stutters the terminal. The column follows the pointer directly, the terminal resizes once on release instead of reflowing and resizing the engine's PTY on every frame, and that resize no longer flashes a blank frame.
