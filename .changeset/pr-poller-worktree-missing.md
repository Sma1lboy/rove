---
"@sma1lboy/rove": patch
---

A task whose worktree was deleted no longer reports `gh` as missing and backs off for minutes: the PR poller names the state `worktree-missing` and stops retrying it as a transient failure.
