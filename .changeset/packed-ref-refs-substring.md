---
"@sma1lboy/rove": patch
---

Read a worktree's packed refs correctly when the checkout's own path contains a `refs` substring.

The daemon's file-level ref reader (`readRefSha`) recovered a ref name from its joined loose-ref path with a non-greedy `/^.*?(refs\/)/` strip, which stopped at the FIRST `refs/` anywhere in the absolute path — so a repo under a segment like `prefs/`, `andrefs/`, or a directory literally named `refs` matched that inner occurrence instead of the ref namespace, and any ref living in `packed-refs` (the normal state after a clone or `git gc`) read as absent. That fed `base-ref-cache.ts` and `behind-cache.ts` an empty base ladder, so the sidebar's base-drift and behind counts for those worktrees silently degraded or resolved against the wrong branch. The reader now matches `packed-refs` entries on the ref names directly, so the path the repo sits under no longer changes what a ref resolves to.
