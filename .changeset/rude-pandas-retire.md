---
"@sma1lboy/rove": patch
---

Teach the agent skill the verbs that actually exist

The bundled agent skill still taught `archive` (removed with issue #75) and a
`land --then-archive` flag that never existed, so an agent closing a parallel
round hit `BAD_VERB`/`BAD_FLAG` with no useful pointer. `archive` is now a
retired verb whose rejection names `delete` and says the branch survives, the
skill's closing-a-round example uses `delete` for losers, and the `send --tab`
docs warn that an explicit `--tab` without `--task-id` inside a dispatched
task delivers to that tab on the *dispatcher*'s task.
