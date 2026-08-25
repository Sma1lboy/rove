---
"@sma1lboy/rove": patch
---

Spawned-task reply coda now teaches the bare `send` (no `--task-id`): the explicit `--task-id <spawner>` form it used to bake in skips dispatcher routing and lands on the spawner task's canonical engine tab — on a main task that can be a different agent's session, so worker outcomes were reported to a stranger. Bare `send` resolves the exact dispatching tab recorded at creation. Skill guidance updated in lockstep (v31).
