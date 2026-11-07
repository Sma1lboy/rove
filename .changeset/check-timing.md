---
"@sma1lboy/rove": patch
---

Rove web's checks list under an open PR now says when each check finished, not just how long it took (`3m12s · 2h ago`), and a running check shows how long it has been going (`running 4m00s`), so a stale green or a stuck job is visible at a glance. The bridge's `pr.checks` rows gain `startedAt` and `completedAt`.
