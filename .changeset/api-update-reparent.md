---
"@sma1lboy/rove": patch
---

`rove api update --task-id A --parent B` now moves an existing task under another without deleting and respawning it: A's engine conversation, tabs, uncommitted work, worktree and branch keep running untouched, A shows under B in the tree, and A's bare `send` now replies to B (B's live engine tab, or the caller's own tab when run from inside B); `--parent none` makes it top level again, `--group GROUPID --parent B` moves a whole `add --count` round, and a parent that is missing on that machine, the task itself, one of its descendants, a project main task or a remote-project task is refused with `PARENT_NOT_FOUND`, `PARENT_IS_SELF`, `PARENT_CYCLE`, `TASK_NOT_MOVABLE` or `REMOTE_PARENT_UNSUPPORTED` and changes nothing.
