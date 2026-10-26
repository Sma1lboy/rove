---
"@sma1lboy/rove": patch
---

`rove api worktree-usage` ranks every task's own worktrees by the disk they take, archived tasks included, and breaks out the gitignored part (dependencies, build output), so you can see which checkouts `remove-worktree` would free most before you run it.

Failed or incomplete measurements stay unknown, including unreachable checkouts; ignored content can include user work and local configuration.
