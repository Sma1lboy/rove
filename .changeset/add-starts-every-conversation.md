---
"@sma1lboy/rove": patch
---

`rove api add` is now the one command that starts a conversation. `add --no-worktree` opens a new conversation in a task's own directory (`--parent` names the task; inside a session it defaults to the caller). Two separate switches say what passes between the two: `--handoff-from tab-N` hands that tab's conversation to the new one, and `--no-dispatcher` turns off the reply address, so the new session knows its parent but does not report back.

`rove api send --tab new` is gone: it is refused and names the `add` command to run instead. Putting a new engine in a dead tab's own place is now `send --tab tab-N --replace`.
