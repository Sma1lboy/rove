---
"@sma1lboy/rove": patch
---

Close a task's last tab, and let a project you're done with leave the sidebar.

`ctrl+w` used to refuse a task's only tab with a toast. It now closes it: the task keeps its sidebar row and its worktree, and `⏎` or `ctrl+e` starts a session there again. Scratch tasks are unchanged — their last tab still ends the task, since the shell is the whole session.

A project whose only row is its main checkout disappears from the sidebar once you close that checkout's last tab. Nothing is deleted: the repo stays in the new-task picker, and opening it there brings the project back. This is deliberately narrower than Forget (`d` on the row), which un-saves the repo — closing the last tab means "done here for now", not "remove this". A project with worktree tasks under it always stays visible, however many tabs are closed, because those rows are how you get back to that work.

Sidebar projects and the new-task picker are now the same set. A project row minted by creating a task never reached the saved-repos list, so it was a project you could see but not pick — 6 of 8 on one machine. Both are written together now, and existing rows are backfilled on daemon start.

The project row's right-click menu also gained "Remove project", which `d` on that row has always done.
