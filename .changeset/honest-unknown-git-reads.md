---
"@sma1lboy/rove": patch
---

A failed git read no longer renders as a clean one. `rove api collect` reports `changes: null` when a worktree's git could not be read at all — it used to report `{added: 0, deleted: 0}`, the same answer a genuinely clean worktree gives, while `collect`'s own summary tells you non-zero means the attempt cannot land. The sidebar's `+N −M` chip now shows a muted `?` for a worktree whose `git status` failed or has not been read yet, instead of hiding the chip and reading as "nothing uncommitted here" — the signal a user checks right before deleting a task. `discover-adoptable`, the Worktrees page and the adopt picker report `dirty: null` / a `dirty?` badge when the probe failed, rather than `false`.
