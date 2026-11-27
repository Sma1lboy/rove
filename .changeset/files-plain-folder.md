---
"@sma1lboy/rove": patch
---

The Files pane (TUI and web) lists the files of a session that runs in a plain folder (`rove .`, No folder, a routine's directory) instead of showing "not a git repository". `node_modules` and `.git` are skipped, and a very large folder lists its first 50,000 entries.
