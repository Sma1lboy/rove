---
"@sma1lboy/rove": patch
---

Say plainly that `set-status canceled` closes nothing, and that `delete` is what ends a task.

An agent asked to "close the finished tasks in this repo" set all six to `canceled` and reported them closed. Nothing had happened: the rows, worktrees, branches and engine sessions were all still there, and the sidebar looked exactly the same. The skill described that verb as "Set lifecycle status" and the API summary as "Set a task's lifecycle status" — neither said the status is a label with no effect on anything, so the verb whose value literally reads `canceled` was the obvious pick.

Both now say what the verb does and does not do, and the skill's lifecycle section leads with the question an agent actually has: closing a task means `delete`, whether or not the work merged, and the git branch survives either way.
