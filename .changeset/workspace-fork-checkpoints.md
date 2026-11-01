---
"@sma1lboy/rove": patch
---

Fork a task with its uncommitted work, and checkpoint and rewind a task's files. `rove api add --fork <task-id>` creates a sibling task whose worktree is a copy-on-write clone of the original's, so modified, staged, untracked and gitignored files (`node_modules`, build output) come along, on a new branch at the original's HEAD; the TUI and web quick-fork do the same when the volume can clone files (APFS, btrfs, XFS) and otherwise start from the last commit and say the uncommitted work stays behind. When an engine finishes a turn, Rove snapshots the task's worktree (edits and new files, not gitignored ones) into `refs/rove/checkpoints/<task>/<n>` without touching your branch, index or HEAD. `rove api checkpoint-list`, `checkpoint` and `rewind --to N` list, take and restore them; a rewind checkpoints the current state first so it can be undone, and is refused while the agent is mid-turn unless `--force`.
