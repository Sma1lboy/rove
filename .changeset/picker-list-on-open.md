---
"@sma1lboy/rove": patch
---

The web New session project picker no longer comes up with only "No folder". When New session was the first thing on screen after a page load or a reconnect, the project list was asked for before the connection was up, failed, and was never asked for again. It now loads on every connect, and so does the GitHub repository list.
