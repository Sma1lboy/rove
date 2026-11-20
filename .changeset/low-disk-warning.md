---
"@sma1lboy/rove": patch
---

When a disk holding your task worktrees drops below 5 GB free, Rove warns you once in the TUI, says how many worktrees share that disk, and points at `rove api worktree-reclaim --merged --dry-run` to find finished ones to free.
