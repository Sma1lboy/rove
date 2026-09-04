---
"@sma1lboy/rove": patch
---

A daemon refusal reaches `rove api` with its own code, not as `RPC_ERROR`.

The daemon already prefixes its refusals with the machine code — an error's
`name` does not survive the RPC wire, so `DIRTY_WORKTREE`, `LAND_CONFLICT`,
`MISSING_REF`, `GIT_COMMAND_FAILED` and the rest ride the message. The CLI
boundary mapped exactly two patterns by hand and flattened everything else:

```json
{"error":{"message":"DIRTY_WORKTREE: task … worktree has uncommitted or untracked changes","code":"RPC_ERROR"}}
```

That is the refusal an unattended cleanup loop hits most, and an agent could
only tell "there is unlanded work here" from "the daemon fell over" by parsing
prose. The boundary now lifts the `CODE: ` prefix once, for every daemon error,
and drops it from the message — so a new orchestrator sentinel needs no CLI
change, and `RPC_ERROR` goes back to meaning "the daemon failed without naming
a reason". `delete`'s dirty-worktree refusal also gains a runnable recovery,
mirroring `land`'s: it sends the worker back to commit its own work rather than
pointing at `--force`, which would discard it. Issue ops now raise
`ISSUE_NOT_FOUND` instead of the untyped `no issue #N`.

`TASK_NOT_FOUND` and the version-skew rejection keep their existing hints.
