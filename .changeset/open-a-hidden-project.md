---
"@sma1lboy/rove": patch
---

Give a project that left the sidebar a way back, and make the empty pane's own keys work.

Closing a project's last tab hides it from the sidebar. Nothing is deleted, and
the rule claimed the repo was "still there in the new-task picker to open again"
— but every submit path went through `createTask`, which always mints a task
worktree, so picking the hidden repo added a worktree beside the project and
still produced no project row. The only real way back was `rove add` in a shell.

The New task dialog's For Existing tab now offers, for a repository Rove already
tracks as a project, a choice between opening a new task worktree and opening
the project itself. The second routes to `ensureMainTask`, so it resolves the
existing checkout rather than creating anything.

Separately, the "No sessions here — press ⏎ or ctrl+e to start one" pane named
two keys that had no handler: both are registered inside the tab component,
which is deliberately not mounted over an empty tab list. The pane now binds
them itself, and reopens the kind of tab that was closed.
