---
"@sma1lboy/rove": patch
---

- A file attached to a web session scheduled with Later is no longer deleted by the 30-day attachment cleanup before that session starts: the cleanup now checks scheduled starts, as it already did task prompts, issues and routines.
