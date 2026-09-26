---
"@sma1lboy/rove": patch
---

Switching tasks no longer runs up to six `git` commands to find the Files pane's Branch-scope base each time: Rove remembers each worktree's base for a few minutes and re-checks it with a single `git rev-parse HEAD` when the answer depends on the current commit.
