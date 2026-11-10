---
"@sma1lboy/rove": patch
---

On Linux the TUI no longer forks `ps` every two seconds to see which engine runs in each tab. It reads the tab shells' process subtrees from `/proc` and falls back to `ps` on other systems or when `/proc` can't answer.
