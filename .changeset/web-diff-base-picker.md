---
"@sma1lboy/rove": patch
---

Rove web's Diff view gets a `[ base: main ▾ ]` picker: compare the task against any local or remote branch, tag, a recent commit of its own branch, or a ref you type. The choice is kept per task, line comments on added and unchanged lines still send their file and line, and `rove api worktree-diff-file` gains `--base REF` (new `worktree-refs` lists the choices).
