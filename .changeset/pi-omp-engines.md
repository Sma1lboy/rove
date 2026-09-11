---
"@sma1lboy/rove": patch
---

Rove now drives `pi` and `omp` as first-class engines, with the same activity badges as the other built-ins. Per-task engine selection, the reasoning-effort picker (`off` through `max`, passed as `--thinking`), tab naming from the engine's own terminal title, session resume, `--fork`, transcript-backed history, and screen-state fallback all apply; and because pi gates a never-seen directory behind a "Trust project folder?" modal that a hosted session cannot answer, Rove pre-answers it in `~/.pi/agent/trust.json`.

The badge channel is a hook Rove writes itself: `rove-activity.ts` goes into `<agent dir>/extensions/`, and both CLIs load it (OMP is Stencil Labs' fork of the pi coding agent and dispatches the same `pi.on(...)` events). It reports session start/end, turn start/complete/failed/interrupted, compaction, and — on OMP — the native approval prompt and question tool as needs-input. It is the one hook install that calls an engine API rather than editing a settings file, and it hands its payload over argv (`kobe hook --payload <json>`) because that API cannot pipe stdin. Nothing is written when `~/.pi` or `~/.omp` does not exist.

Waiting is where the two differ, and the badge follows each CLI rather than the pair: OMP reports its approval prompt exactly, pi has no approval prompt to report and falls back to its screen rules. Pi and OMP also report a user interrupt from the aborted assistant message, which is the first native interrupt signal Rove has from any engine.
