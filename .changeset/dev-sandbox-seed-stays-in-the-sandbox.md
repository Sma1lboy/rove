---
"@sma1lboy/rove": patch
---

`dev:sandbox seed` cuts its tasks from a throwaway repo inside the sandbox, so seeding no longer registers worktrees and branches in your own checkout; `reset` drops that repo.
