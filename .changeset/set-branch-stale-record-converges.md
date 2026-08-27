---
"@sma1lboy/rove": patch
---

`rove api set-branch` no longer fails with "no branch named …" when the rename already happened. The task record's branch name can go stale — a retried call whose first attempt renamed but lost its response, a concurrent rename, or an out-of-band `git branch -m` in the worktree — and the rename then errored against the main checkout even though the worktree was already on the requested name, leaving the caller unable to tell partial success from failure. `renameBranch` now probes the end state on failure: old name gone and new name present is the requested outcome, so it succeeds and the record converges; anything else still fails.
