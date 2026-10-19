---
"@sma1lboy/rove": patch
---

- Switching back to a task whose files have not changed no longer re-runs `git ls-files` for the Files pane: the pane keeps watching the last four worktrees it showed and reuses a listing no file event has touched.
