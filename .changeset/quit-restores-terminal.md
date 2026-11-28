---
"@sma1lboy/rove": patch
---

[tui] Quitting Rove restores the terminal before it exits. On Windows the interface stayed painted after `q`, with the shell prompt drawn over it and a `terminal restoration did not complete` error in red; the screen now clears as it should.
