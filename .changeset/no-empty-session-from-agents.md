---
"@sma1lboy/rove": patch
---

Refuse `rove api add` from inside a session when it would create a task with no agent (`EMPTY_SESSION`): pass `--prompt` or `--start` for a session, or `--worktree-only` for a checkout. The rove skill says the same.
