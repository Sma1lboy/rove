---
"@sma1lboy/rove": patch
---

Remove the daemon-disconnect banner from the workspace

A socket drop used to paint a full-width red DAEMON DISCONNECTED strip above the pane row. Rove keeps working with the daemon down, and the reconnect loop recovers most drops in well under a second — so the banner interrupted to announce something with nothing to act on, and each blip reflowed the whole window as it appeared and vanished.

The version-skew banner stays: a stale daemon build persists until someone restarts it, which is an action.
