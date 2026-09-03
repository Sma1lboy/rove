---
"@sma1lboy/rove": patch
---

Sidebar rows now say when a worktree has fallen behind its base. `↓N` joins `+N −N` in the warning tone, counting the commits the base has that the worktree does not, and `≠` marks a PR GitHub reports as `CONFLICTING` — a field the poller has been collecting since it landed and nothing rendered. Both come from the daemon's existing per-worktree read, so no new polling. The row menu gains **Sync with base**, which merges the base in (never rebases — the worktree may have a live engine holding files open) and reports a conflict the way landing already does. `rove api collect` gains `base.behind` beside `base.ahead`. A proposed `ctrl+a u` chord mirrors the menu entry; it shadows nothing and is awaiting owner sign-off.
