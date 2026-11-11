---
"@sma1lboy/rove": patch
---

**Later** in the web New session composer no longer creates a task ahead of time. The daemon keeps the start in `pending-starts.json` and creates the task with its engine and first message when the time comes, so no row, worktree or branch exists before then. A start whose time passed while the daemon was down runs when it comes back. Pending starts are listed on the Routines page under LATER, where each can be cancelled; one that failed stays there with its reason. Tasks that already carry a start time from the old path still start on time.

A task created from the TUI's New task dialog now starts its engine as part of the create, not when you enter it. If the engine cannot start (the engine cap, a failed checkout, no PTY host), the row stays selected, the failure replaces the "Creating task…" toast with the full reason, and Enter on the task retries. Toasts no longer slide under the status line while a banner shows at the top of the window.

A delayed or routine start into a tab whose session is already running now pastes its first message into that engine, or fails with `NOT_DELIVERED`. It used to report success while the message was dropped.
