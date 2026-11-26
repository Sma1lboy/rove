---
"@sma1lboy/rove": patch
---

- The terminal UI's task list shows a row's state at the end of the row, in one column at the list's edge with the cloud mark before it, as the web does, instead of before the title.
- The terminal UI's task list is quieter: a row no longer shows how long it has been running or waiting, a child task no longer wears a shared/own-worktree mark, and a project name stands without a rule after it.
- The bottom bar no longer shows the session's token total.
- The task list's header reads like the web's: the `[ rove ]` wordmark on the left and `inbox 3` on the right.
- A child task hangs off its parent on a `└` line.
- A task on another machine wears `↗` instead of a cloud, which most terminal fonts lack and drew off the row's line. Where it runs (`on win · v0.9.301`) shows while the mouse is over the row, no longer on the keyboard cursor's row.
- A pull request's mark in the task list is one `◆`, amber for a conflict, red for failing checks, green for passing, in place of `≠` / `✗` / `✓`.
- A quiet task draws no mark at the end of its row, so only tasks that are working or waiting on you stand out, and the header has a blank line under it.
