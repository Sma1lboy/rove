---
"@sma1lboy/rove": patch
---

Remove the PTY host's human-write sensor. `lastHumanWriteMs` and the
`KOBE_PTY_HUMAN_WRITE_QUIET_MS` quiet period only ever fed the delivery gate,
which is gone — `pty.peek` no longer reports them, and a freeze record written
by an older host thaws normally with the stale field ignored.
