---
"@sma1lboy/rove": patch
---

Five probes that reported a neutral answer when they had actually failed.

`delete --delete-branch` discarded `git branch -d`'s exit code, so a branch git
refused to delete (the ordinary case for work that never landed) left the
daemon log confirming `removed … branch=<name>`. The refusal is now carried out
of the removal and logged as its own `branch kept …` line, with git's reason.
The delete itself is unchanged — still best-effort, still never fails the
removal.

"Fix failing checks" told users the checks were probably no longer red whenever
`gh` could not answer at all. A missing `gh`, an expired `gh auth login`, and a
genuinely green PR were one empty list; the read now reports which, and the
toast quotes `gh`'s own stderr.

Three probes stopped encoding "could not look" as "nothing there": the
non-force delete gate now refuses when `git status --ignored` fails instead of
reading the empty result as permission; `rove doctor` says
`could not read process environments` instead of `orphans: ✓ none` when the
environment probe never ran; and the three copies of the dirty-worktree check
share one definition, so a `git status` output of just a newline no longer
reads dirty to the delete gate and clean to landing.
