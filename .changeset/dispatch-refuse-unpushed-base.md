---
"@sma1lboy/rove": patch
---

Dispatching to another machine with `--base-branch` from a checkout on this machine now refuses a base that has commits no remote has, with `UNPUSHED_BASE`, the number of commits and the exact `git push` to run. The other machine only has what was pushed, so before this the task failed over there or was built on an older base.
