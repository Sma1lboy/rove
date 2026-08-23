---
"@sma1lboy/rove": patch
---

Creating a git worktree no longer auto-adopts it onto the sidebar. Agents mint worktrees for PR isolation and no engine session ever enters them, so "created" isn't "wanted as a task" — those showed up as ghost tasks with no prompt and no session. Adoption now requires intent: an engine session starting inside a managed worktree root, or an explicit adopt (`rove add .` / New task → Adopt Worktree). Removing a worktree still archives its task.
