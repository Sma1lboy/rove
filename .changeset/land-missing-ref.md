---
"@sma1lboy/rove": patch
---

`rove api land` no longer reports a phantom merge conflict when a task's branch was renamed or deleted outside Rove. The ahead-count probe ignored git's exit status, so an unresolvable branch produced an unreadable count that read as "this branch has work", and the merge that followed failed for an unrelated reason and surfaced as `LAND_CONFLICT` with an empty conflicted-file list. Land now refuses up front with `MISSING_REF`, naming the branch, the base branch, and the base repo, and leaves the base checkout untouched.
