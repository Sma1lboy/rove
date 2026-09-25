---
"@sma1lboy/rove": patch
---

Switching tasks and typing in a terminal tab no longer run `git rev-parse` on every redraw to look up a repo's init override: Rove skips the lookup when no override is saved and matches the repo path directly before asking git.
