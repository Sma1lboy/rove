---
"@sma1lboy/rove": patch
---

`rove api send` pastes the prompt and presses Enter for every engine, instead of reading the engine's own repaint for a "tab to queue message" footer to decide between Enter and Tab. That read had a 450ms budget against a redraw the engine controls: when the footer arrived late the text stayed in the engine's input box while the send still reported a confirmed delivery, and a burst of output that rolled the read offset out of the scrollback ring let a stale hint from an earlier turn press Tab at an idle engine. Peer messages no longer pile up in the input area. Delivery no longer reports `queued`, since nothing observes the engine's queue state any more; what an engine does with an Enter received mid-turn is its own behavior.
