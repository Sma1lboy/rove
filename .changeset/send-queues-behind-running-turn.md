---
"@sma1lboy/rove": patch
---

`rove api send` now gets through to an engine that is mid-turn. Claude Code, while a turn is running, no longer submits on Enter: its footer says "tab to queue message" and the text just sits in the composer — which is where every dispatched `succeeded:` report landed while the coordinator was busy. Delivery now reads that hint off the screen after pasting and presses Tab instead, so the prompt is queued and runs when the turn ends; a late footer redraw is caught by one re-check after Enter. The result reports `queued: true` when that happened, so a dispatcher knows the report is waiting behind a turn rather than being processed now.
