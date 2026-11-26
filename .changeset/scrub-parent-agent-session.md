---
"@sma1lboy/rove": patch
---

Sessions keep their transcripts, so `--resume` finds them, even when Rove was started from inside a Claude Code session. Rove no longer passes that session's child marker on to the engines it starts.
