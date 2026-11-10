---
"@sma1lboy/rove": patch
---

A checkout cut with `rove api add --worktree-only` no longer shows as a row for the seconds git takes to make it. The task was created first and marked hidden only after its worktree existed; it is now created already marked. A cut that fails takes the mark off, so the row it leaves can be seen and deleted.
