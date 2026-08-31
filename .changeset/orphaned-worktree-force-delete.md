---
"@sma1lboy/rove": patch
---

Let a forced delete clear a task whose worktree lost its repo.

When a worktree's upstream checkout is destroyed — a deleted clone, or macOS pruning one under `/tmp` — `git worktree remove` has nothing to resolve, so removal threw and the task stuck at `deletion.phase: "error"`. Retrying re-ran the same unsatisfiable path, and `--force` never reached: the repo lookup threw before the force flag was read. No supported command could clear the entry; the only way out was moving the directory by hand so Rove took its path-does-not-exist branch.

A forced removal now deletes the orphaned directory outright, guarded by path — only a directory under a Rove-managed worktrees root qualifies, so force is still not permission to delete something Rove never created. Without `force` the case stays an error, as before.
