---
"@sma1lboy/rove": patch
---

`land` no longer reports a removed worktree as kept. `removeLandedWorktree` wrapped the git removal and the task-store write in one try/catch, so a failed `clearWorktreePath` returned `{ removed: false }` for a directory that was already gone — sending you to look for a worktree that no longer exists. The two are separated: once the removal succeeds the outcome is `removed: true`, with the bookkeeping failure carried in `reason`.

Also corrects docs that still described `--remove-worktree` as opt-in after it became the default: the fan-out walkthrough in `ORCHESTRATION.md`, the daemon's wire-contract comment, and the agent-facing skill tables (now `--remove-worktree(true)`, matching `--archived(true)`).
