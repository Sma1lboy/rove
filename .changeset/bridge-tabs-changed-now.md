---
"@sma1lboy/rove": patch
---

A tab opened, closed or moved in the TUI or from the CLI shows in the web client 0.2 to 0.4 seconds sooner. The web bridge learned of it by polling `state.json` every 200 ms and then waiting 200 ms for writes to settle; it now also listens to the daemon, which announces the change as it happens.
