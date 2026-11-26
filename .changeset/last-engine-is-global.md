---
"@sma1lboy/rove": patch
---

The engine a new task or conversation opens on is now the one you picked last in any project, instead of one remembered per project. Pick Codex in one repo and the next session in another repo opens on Codex too. Setting the default in Settings → Engines counts as a pick, so it takes effect right away. Per-project entries already in `state.json` (`lastActiveVendor.<repo>`) are no longer read.
