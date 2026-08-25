---
"@sma1lboy/rove": patch
---

Fold the four duplicated binding-stack reachability scans in `keymap-dispatch.ts` into one `scanReachability` helper, removing the drift risk between prefix/passthrough/HUD/options gating.
