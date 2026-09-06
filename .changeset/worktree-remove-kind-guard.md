---
"@sma1lboy/rove": patch
---

The Worktrees page can no longer delete a directory Task's own directory, or a project's own checkout. Both appear on the page — it lists every registered worktree of a saved project — and deleting one removed files Rove never created, then skipped the pointer repair, leaving the Task aimed at a directory that no longer existed. `worktree.remove` now refuses both by task kind (`NOT_A_ROVE_WORKTREE`), matching every other destructive path.
