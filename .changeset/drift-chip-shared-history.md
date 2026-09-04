---
"@sma1lboy/rove": patch
---

The sidebar's drift chip no longer measures against a branch that never touched the work. The daemon's base-ref ladder took the first candidate that resolved, so a repo with an abandoned orphan `main` beside its real `develop` base reported drift against history the task never forked from. Every candidate now has to survive `git merge-base <ref> HEAD`, and the base checkout's own branch is the last resort — the same rule `rove api collect` adopted in the previous release.

The correctness is free on an idle tick: each cached answer carries the HEAD and candidate shas it was reached on, all read from ref files, so an unchanged worktree renews without spawning anything. Measured at 19 worktrees, five-minute idle cost is unchanged at zero `git` processes; one `git merge-base` per worktree is paid when HEAD or a base ref actually moves.
