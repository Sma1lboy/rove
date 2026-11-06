---
"@sma1lboy/rove": patch
---

A task created in the wrong project can now be moved: "Move to project…" in the TUI and web row menus, or `rove api update --task-id ID --project PATH`. Only the grouping changes — the live session, worktree and branch stay where they are, and a moved worktree task still deletes and lands in the repo that cut it.
