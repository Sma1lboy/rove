---
"@sma1lboy/rove": patch
---

`rove api … --machine auto` lets Rove place the work. It runs on the registered machine with the fewest tasks in progress, this machine winning a tie, and skips a machine that does not answer. The choice and the counts it compared are printed on stderr. The same `"machine": "auto"` works over the daemon socket and the bridge.
