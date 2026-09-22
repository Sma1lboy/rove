---
"@sma1lboy/rove": patch
---

The task rail's draggable right edge now shows itself through the mouse pointer: over the edge, and for the whole drag, the pointer turns into a left-right resize arrow. Before, nothing at all marked the edge, so the drag-to-resize looked like it didn't exist. Nothing is drawn — the rail looks exactly as it did — and terminals that don't let an app set the pointer shape keep their usual arrow; the edge still drags there.
