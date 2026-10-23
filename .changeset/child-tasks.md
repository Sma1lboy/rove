---
"@sma1lboy/rove": patch
---

A task now holds one conversation, and a second conversation is a child task shown under it in the sidebar. `ctrl+t`, the engine picker, `send --tab new`, `tab-new --kind engine` and the web `+` open a child that shares the task's directory. Agents can call `rove api spawn` to start a child in its own worktree, cut from the parent's branch tip, or in the same directory with `--no-worktree`. Existing tasks with several engine tabs split into child tasks on the next daemon start, and running sessions keep running. Deleting a task with children promotes them to the top level by default (`delete --cascade` removes the whole subtree), and a directory is removed only once no task still uses it.
