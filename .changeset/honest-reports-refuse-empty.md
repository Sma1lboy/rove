---
"@sma1lboy/rove": patch
---

Refuse a `succeeded:` report from a branch with no commits, and give agents Rove's own CI truth

`rove api send` now checks a completion claim against the sender's own branch. A `succeeded:` report from a managed task whose branch has 0 commits is refused with `EMPTY_SUCCESS_REPORT` and never reaches the coordinator — the evidence was already in hand at that moment, while `land`'s `EMPTY_BRANCH` only caught it two steps later, after the coordinator had believed the report. Work that legitimately produces no commits (an investigation, a review) passes `--allow-empty`.

"CI is green" was being asserted from local test runs because the real answer was out of reach: `get-task` never named `.task.prStatus.checkState`, and the poller that fills it paused whenever no GUI was attached — exactly during an unattended run. The poller now also runs while an engine is live, and `checkState` is documented as what "green" means.
