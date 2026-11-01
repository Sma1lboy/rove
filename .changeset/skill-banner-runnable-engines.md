---
"@sma1lboy/rove": patch
---

The "Rove skill not installed" banner (TUI and web) names only engines Rove can run here. A config folder left behind by an uninstalled CLI, such as `~/.copilot` with no `copilot` on PATH, no longer puts that engine on the list.
