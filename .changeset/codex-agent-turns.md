---
"@sma1lboy/rove": patch
---

`rove api agent-turns` now reports Codex turns. Codex's rollout records
`task_started`/`task_complete` with the turn id it assigns, plus the model and
per-request token deltas, so a Codex task's turns now carry model, wall-clock,
and tokens like Claude's. Its hook also reports session identity now — without
that the daemon had a turn to record and no transcript to read it from. Engines
with no turn reader still contribute nothing, and the verb says so rather than
returning a confident empty page.
