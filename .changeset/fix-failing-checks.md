---
"@sma1lboy/rove": patch
---

The sidebar's red PR chip is no longer a dead end: a row whose checks are failing gains a **Fix failing checks** entry that pulls the failing job's log tail out of GitHub and pastes it into that task's own engine, with the branch, the PR number and the job names named. The daemon fetches on demand only — a whole job log is far more expensive than the rollup the poller reads every tick, so nothing here rides the poll interval. A proposed `ctrl+a k` chord mirrors the entry; it shadows nothing and is awaiting owner sign-off.
