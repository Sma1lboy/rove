---
"@sma1lboy/rove": patch
---

A task's PR chip shows up even when its agent pushed to a branch named differently from the task's: Rove falls back to the PR whose head is the task's HEAD commit, then keeps following that PR number.
