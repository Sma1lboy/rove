---
"@sma1lboy/rove": patch
---

The daemon's six file-backed stores (issues, field notes, automations, attention inbox, deferred prompts, agent turns) now share one atomic JSON write. Issues and notes previously staged through a fixed `.tmp` name, which two daemons overlapping during `rove daemon restart` could truncate and rename over the real file; every store now uses a per-process, per-write temp name. On-disk format is unchanged.
