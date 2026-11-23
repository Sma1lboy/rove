---
"@sma1lboy/rove": patch
---

`rove config --help` no longer says a hand edit of state.json waits for the next launch: saved edits already reach every running Rove window on their own, and the help and configuration docs now say so, naming the few startup-only settings and the per-window layout that stay put.
