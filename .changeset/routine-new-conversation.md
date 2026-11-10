---
"@sma1lboy/rove": patch
---

A persistent routine can start a new conversation on every run while keeping its standing task and worktree: `rove api routine-create|routine-update --new-conversation`. Without it, a run that reopens the standing task's conversation now gets the one-line "instructions unchanged" prompt instead of the whole prompt again.
