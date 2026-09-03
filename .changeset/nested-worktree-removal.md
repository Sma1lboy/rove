---
"@sma1lboy/rove": patch
---

**A task whose worktree sits inside its own repo is deletable again.** When `git worktree remove` deregistered the worktree but could not delete its directory, Rove classified the leftover by asking `rev-parse --git-common-dir` from inside the path — and git's discovery walks up parent directories, so for a worktree nested under its own checkout (every remote project, and legacy repo-local roots) it resolved the parent repo and reported a path git had already forgotten as still registered. The removal threw, every retry threw identically, and the task parked in `deletion.phase: "error"` forever. Registration is now asked of the owning repo via `git worktree list`, which is the only place that holds the answer. The leftover directory is still reported, never deleted — it sits inside the user's checkout.

Also: removing a worktree whose directory had already vanished never pruned the stale `.git/worktrees/<name>/` registration, because it probed the repo with `cwd` set to the missing path. It probes the parent now, so the path is re-addable instead of failing a later `git worktree add`.
