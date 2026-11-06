---
"@sma1lboy/rove": patch
---

Rove web's Diff view gets review polish: a `[ ws ]` toggle hides whitespace-only changes (the daemon runs `git diff -w`; `rove api worktree-diff-file` gains `--ignore-whitespace`), a `[ viewed ]` mark per file folds it and holds until that file's diff changes, the strip above the diff shows total +/- and "n/m viewed", and `[ next file ]` / `[ next comment ]` jump between files and your comments.
