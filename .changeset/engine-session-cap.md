---
"@sma1lboy/rove": patch
---

Set `engine.maxLiveSessions` to cap how many engine sessions `rove api` runs at once: an `add` or `send` that would start one more is refused with `ENGINE_LIMIT` and a ready-to-run retry, so a scripted fan-out can't overload your machine.
