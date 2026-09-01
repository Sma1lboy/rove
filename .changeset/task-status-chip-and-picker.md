---
"@sma1lboy/rove": patch
---

Set a task's status from the TUI, and see it on the row. The sidebar's
right-click menu gains **Set status**, a picker over the six task statuses, and
a task row now carries a mark once its status leaves `backlog`/`in_progress`:
`◇` in review, `◆` done, `†` canceled, `×` error. The status is still just a
label — picking `canceled` relabels the task and leaves its worktree, branch
and running sessions exactly where they were.
