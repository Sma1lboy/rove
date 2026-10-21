---
"@sma1lboy/rove": patch
---

`rove --web` opens a task on another registered machine like a local one. Its tabs list under it in the rail, its terminal is that machine's live session (you can watch and type), and the Files pane shows that machine's worktree: the file list, the changed files and each file's diff. Before, clicking it only said the worktree lived elsewhere. Three read verbs back the Files pane and work on any task from the CLI too: `rove api worktree-files`, `worktree-diff` and `worktree-diff-file --path P --scope branch|working`; run against a task on another machine they execute there. The other machine needs a Rove with these verbs; opening a file in an editor stays on the machine that has it.
