---
"@sma1lboy/rove": patch
---

`rove api add --workspace-on <machine>` runs the agent on this machine and keeps its files and commands on another registered machine. That machine cuts the worktree, so it needs Rove and git, but no engine and no engine sign-in. Every engine reaches the worktree through an `rx '<command>'` on its PATH; Claude Code's Bash tool runs there as it is, and it gets read, write and edit tools for that machine's files. Deleting the task removes the worktree there too.
