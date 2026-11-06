---
"@sma1lboy/rove": patch
---

A conversation can now move to another engine without leaving the directory. "Continue in another engine…" is on the tab menu, the task row menu and the dead-engine notice (web and TUI), and `rove api send --tab new --command codex --handoff-from tab-1` does the same for agents. The new engine's first prompt carries the task title, the user's last request and a bounded excerpt of the latest turns, besides the old transcript's path.
