---
"@sma1lboy/rove": patch
---

`rove api worktree-usage` takes `--merged` and `--idle-days N` to list only the task worktrees worth cleaning up: tasks whose pull request has merged, or that have sat untouched for N days. Each row now also says where its pull request stands.
