---
"@sma1lboy/rove": patch
---

The sidebar row menu can re-run a Task's brief. Rove already stored the prompt each Task was created with, but nothing in the TUI read it — recovering a brief meant piping `rove api get-task` into `rove api add` by hand. **Run again** now shows that brief in full and re-fires it verbatim into a new Task with its own branch and worktree, leaving the original alone. Tasks created without a prompt have no brief to re-run, so the entry stays hidden for them.
