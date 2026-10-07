---
"@sma1lboy/rove": patch
---

The dirty-worktree file list in the force-delete confirm, `rove api delete`, land and sync refusals now shows filenames as they are on disk: non-ASCII names like `笔记.md` and names with spaces no longer appear as git's quoted octal escapes, and a staged rename names its new path instead of `old -> new`.
