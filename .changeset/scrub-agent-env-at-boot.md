---
"@sma1lboy/rove": patch
---

The daemon and the PTY host forget the agent session they were started from, so a restart run from inside Claude Code can no longer stop the sessions Rove starts from saving their transcripts.
