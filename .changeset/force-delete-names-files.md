---
"@sma1lboy/rove": patch
---

The force-delete confirm now lists the uncommitted files it would sweep into the salvage snapshot — the first ten, then a count of the rest — on the task row as well as the Worktrees page, and `rove api delete` names them in its `DIRTY_WORKTREE` refusal.
