---
"@sma1lboy/rove": patch
---

Rove no longer prints `MaxListenersExceededWarning: 11 resize listeners added to [CliRenderer]` into the terminal when it starts. Every pane and dialog used to add its own resize listener to the renderer; they now share one.
