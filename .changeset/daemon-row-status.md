---
"@sma1lboy/rove": patch
---

The TUI and the web show the same status for every task and tab, because the daemon now decides it. It reads the engine activity, the attention inbox, the terminal sessions (alive, restored after a restart), worktree jobs and deletions itself, and every client only draws what it sends. Looking at a tab in any client clears its unread mark everywhere, and answering a question clears its `?` everywhere. Each tab row shows its own status, a task row shows the summary only when its tabs are folded, rate limits read amber and errors red in both, and tasks on other machines show a status in the TUI as well.
