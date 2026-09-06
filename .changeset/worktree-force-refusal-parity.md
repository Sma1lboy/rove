---
"@sma1lboy/rove": patch
---

The Worktrees page reaches the force-delete confirm for all three delete refusals, not just one. A worktree whose only work is gitignored — a `HANDOFF.md`, a `.scratch/` — refuses through a different message than a porcelain-dirty one, and the page matched that one message as prose, so two of the three refusals dead-ended in a red toast with no way to reach the two-stage force flow. The page now discriminates on `DIRTY_WORKTREE`, the same test the task-row delete uses, and the force confirm names the gitignored paths `git status` cannot show you.
