---
"@sma1lboy/rove": patch
---

Archive a task to hide it without deleting anything: the task row menu in the TUI and the web has Archive, and `rove api archive` / `unarchive` do the same from a shell. The task and its children move to an "Archived" fold at the end of the sidebar and the rail, where Unarchive brings them back; the worktree, branch and sessions stay as they were. If an engine in the task is still working or waiting on you, Rove asks before hiding it. `rove api list` leaves archived tasks out unless you pass `--archived`.
