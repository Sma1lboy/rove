---
"@sma1lboy/rove": patch
---

Fix the two `commit-tree` calls in the daemon test fixtures that never passed a git identity, which failed every release run on CI where no global `user.name` exists.
