---
"@sma1lboy/rove": patch
---

Retrying a `rove api send` from inside another task with the `nextCommandArgs` an `ENGINE_LIMIT`, `ENGINE_NOT_RUNNING` or `TAB_RESTORED` refusal hands back now delivers the message with a single `[ROVE PEER]` header, instead of stacking a second copy on top of the one the first attempt already added.
