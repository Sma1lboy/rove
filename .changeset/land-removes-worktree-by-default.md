---
"@sma1lboy/rove": patch
---

`land` now removes the task's worktree by default. A landed branch's worktree is spent, but removal was opt-in behind `--remove-worktree`, so every land left a dead directory behind — eleven of them after one night of fan-out work. Landing from the CLI, the TUI worktrees page, or the API now cleans up unless you pass `--remove-worktree=false`.

The **branch is untouched** — git stays the durable record. Removal still never forces: a dirty worktree, the base checkout, and the worktree the caller is running from are all refused, and the refusal is reported (the TUI now prints why) instead of failing the land. The CLI always tells the daemon where it is running from, so an agent landing its own task can no longer delete its own working directory.
