---
"@sma1lboy/rove": patch
---

Stop losing engine config when Rove and Claude write it at the same time. Worktree pre-trust (`~/.claude.json`) and the global hook install (`~/.claude/settings.json`) read-modify-wrote these files with no coordination, from three Rove processes plus Claude Code itself — a lost merge could silently drop an `allowedTools` grant (the agent re-asks for permission) or a task's trust entry (its session sits at "Do you trust the files in this folder?" forever), both of which read as engine bugs. Both writes now run under a cross-process lock and a compare-and-swap against the engine's own wholesale rewrites, and land via a per-call staging file instead of a shared one.
