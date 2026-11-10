---
"@sma1lboy/rove": patch
---

A routine's own task no longer keeps an engine running between runs: when a run's turn ends and nothing else is waiting on that tab, the engine is stopped. A persistent routine's next run starts it again in the same worktree and reopens the same conversation where the engine has a resume command (recorded as `revived`). Routines bound to an existing tab are unaffected.
