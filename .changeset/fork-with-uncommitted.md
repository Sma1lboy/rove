---
"@sma1lboy/rove": patch
---

Fork a task with its uncommitted work. `rove api add --fork <task-id>` creates a sibling task whose worktree is a copy-on-write clone of the original's, so modified, staged, untracked and gitignored files (`node_modules`, build output) come along, on a new branch at the original's HEAD. The TUI and web quick-fork do the same when the volume can clone files (APFS, btrfs, XFS) and otherwise start from the last commit as before and say the uncommitted work stays behind.
