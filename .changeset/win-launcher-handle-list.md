---
"@sma1lboy/rove": patch
---

On Windows, a daemon or PTY host started in the background no longer holds on to the terminal or ssh session that started it: `rove daemon restart` over ssh returns at once instead of when the daemon exits.
