---
"@sma1lboy/rove": patch
---

`rove api add --worktree-only` cuts a task's worktree and starts no engine, for a session that only needs a separate checkout to work in. Nested under its parent, such a task is not listed in the sidebar or the web rail until an engine starts a turn in it, so a checkout no longer shows up as an idle child session.
