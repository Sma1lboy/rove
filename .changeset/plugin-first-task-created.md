---
"@sma1lboy/rove": patch
---

Plugins now see the FIRST `task.created` after a daemon start. The daemon
publishes its baseline task snapshot while wiring the orchestrator, minutes of
code before the plugin host exists, so the first snapshot the host's reducer
ever saw was the first real mutation — and the reducer's "the first snapshot is
the pre-existing list, not a burst of creates" rule swallowed it. Every daemon
lifetime silently lost its first `task.created` / `worktree.created` /
`task.changed`; the second task onwards worked, which is why the smoketest
missed it (it fired `issue.changed`, which is reported directly and never
passes through that reducer). The host now seeds itself from the bus's
last-value cache, and the sandbox smoketest asserts `task.created` first.
