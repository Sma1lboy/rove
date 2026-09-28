---
"@sma1lboy/rove": patch
---

Switching tasks no longer spawns `git rev-parse HEAD` to revalidate the Files pane's branch base: a local worktree's HEAD is read from its git files instead, cutting git spawns per task switch from 2.6 to 1.6.
