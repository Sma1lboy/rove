---
"@sma1lboy/rove": patch
---

Tasks now get file checkpoints. When an engine finishes a turn, Rove snapshots the task's worktree (edits and new files, not gitignored ones) into `refs/rove/checkpoints/<task>/<n>` without touching your branch, index or HEAD. `rove api checkpoint-list`, `checkpoint` and `rewind --to N` list, take and restore them; a rewind checkpoints the current state first so it can be undone, and is refused while the agent is mid-turn unless `--force`.
