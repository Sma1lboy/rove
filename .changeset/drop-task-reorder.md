---
"@sma1lboy/rove": patch
---

Internal: removed the `task.reorder` slice. It was a complete vertical — protocol verb, daemon handler, orchestrator and store methods, a persisted `position` field, two serializers and a codec branch — with no producer and no consumer. It ordered cards on the web board's per-status columns, and the board no longer carries task cards; the sidebar's move mode uses `task.move`. A `tasks.json` written before this still loads: the codec ignores keys it does not know, so a leftover `position` is dropped on the next save.
