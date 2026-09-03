---
"@sma1lboy/rove": patch
---

Stop idling a working Claude engine mid-turn. The Claude turn detector treated
every assistant transcript record as a completed turn, but Claude Code appends
one per step and ~95% of them are `stop_reason: "tool_use"` — mid-turn. The
daemon's lapse watchdog read the newest of those as "this turn already ended"
and dropped the activity badge to idle at the 10-minute TTL while the engine was
still working, with its heartbeat re-arm unreachable. The marker now requires a
turn-ending `stop_reason` (`end_turn`, `stop_sequence`, `max_tokens`,
`refusal`); `tool_use`, `pause_turn` and a missing reason all read as still
running.
