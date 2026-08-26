---
"@sma1lboy/rove": patch
"@sma1lboy/rove-plugin-sdk": patch
---

Plugins now see the whole product move, not just the corners a handler
remembered to report. Task events derive from field-level snapshot diffs, so
`task.archived` fires however a task got archived (including the
`git worktree remove` sweep and `land --then-archive`) and `worktree.created`
fires for adopted worktrees too — both previously dropped. New catalog
entries: `task.changed` (fields/from/to), `task.pr-changed`,
`automation.dispatched/skipped/failed`, `quota.exhausted/resumed`,
`session.exited` (the crash signal, off the PTY host's death records),
`note.filed`, `message.delivered`, `attention.handled`, and
`plugin.enabled/disabled`. `turn.complete` now carries the finished turn's
model + token usage. Manifests gain `[[shutdown]]` hooks (bounded ~3s at
daemon stop) and `[engines.identity]` for composer copy, and
`rove api engine-report` lets a plugin-contributed engine drive the sidebar
badge, attention inbox, and event stream without a built-in hook adapter.
