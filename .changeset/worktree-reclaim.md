---
"@sma1lboy/rove": patch
---

`rove api worktree-reclaim --merged` (or `--idle-days N`) frees the disk of every finished task's worktree in one go, keeping each task and branch; anything with work in it, a busy engine or your own checkout is skipped and reported, and `--dry-run` previews the list.
