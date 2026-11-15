---
"@sma1lboy/rove": patch
---

Set how often open PRs refresh their status and checks with `pr.refreshSeconds` in `state.json` (30-3600 seconds, or `0` to pause background refresh); the daemon picks up the change without a restart, so many open PRs no longer have to spend GitHub API quota every 30 seconds.
