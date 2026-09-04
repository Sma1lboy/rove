---
"@sma1lboy/rove": patch
---
Bound slow daemon clients and incoming daemon/PTY requests to prevent unbounded buffering. Keep the latest complete snapshot for each channel under backpressure while preserving RPC, lifecycle, command and terminal byte ordering until disconnection.
