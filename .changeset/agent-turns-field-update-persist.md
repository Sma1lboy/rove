---
"@sma1lboy/rove": patch
---

Agent-turn telemetry no longer loses a turn's final token counts across a daemon restart. Every Stop hook re-reads the whole transcript, so a finished turn arrives again — often more complete than before (fuller `usage`, a corrected `endedAt`). The store applied that newer version in memory but skipped the disk write whenever the batch introduced no brand-new turn id, so the last write won only until the next `rove daemon restart`, which reloaded the stale record. The store now persists a re-read whose fields actually changed, while still skipping the write for a byte-identical re-scan (the common no-op), so `rove api agent-turns` reports the same numbers before and after a restart.
