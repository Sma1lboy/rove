---
"@sma1lboy/rove": patch
---

Sessions that work in the same checkout on another machine (`rove api add --machine <alias> --no-worktree`) now share one working directory here, so `claude --resume` in a new session lists the earlier ones. They also share one row on that machine, which goes away with the last of them. The session's instructions now say that a session that ran natively on that machine can only be continued there or with `--engine-there`.
