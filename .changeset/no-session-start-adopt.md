---
"@sma1lboy/rove": patch
---

A worktree made outside Rove no longer becomes a session on its own. Starting an engine in one (for example `claude --worktree`) used to add a never-started row named after the directory; now only `rove add .`, `rove adopt` and New task → Adopt Worktree add one. If the sidebar still holds such rows from an older version, the TUI and the web ask once, in a dialog, whether to hand them to an agent: it lists them and removes the ones you confirm.
