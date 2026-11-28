---
"@sma1lboy/rove": patch
---

[tui] Leaving Rove restores the terminal before the process exits or hands it on. On Windows the interface stayed painted after `q`, with the shell prompt drawn over it and a `terminal restoration did not complete` error in red; the screen now clears as it should. The same fix covers Settings → reset UI state, the in-app updater, and restarting or refreshing Rove.
