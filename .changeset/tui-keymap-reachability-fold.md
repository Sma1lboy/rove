---
"@sma1lboy/rove": patch
---

Unify binding-stack reachability scanning for cold callers (`armPrefixNow`, `bindingReachability`) into one `scanReachability` helper while keeping the per-keypress `dispatchKeyEvent` hot path on early-exit helpers so the binding-stack budget tests stay green.
