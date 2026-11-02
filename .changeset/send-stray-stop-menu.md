---
"@sma1lboy/rove": patch
---

`rove api send` no longer approves a permission menu when a stray turn-complete event arrives while the menu is still on screen. A tab that came to rest straight from a menu, without a running turn between, now refuses with `AWAITING_PERMISSION` like `--queue` already did, and a tab that only just came to rest is checked again right before the paste.
