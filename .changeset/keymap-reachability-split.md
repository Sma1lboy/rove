---
"@sma1lboy/rove": patch
---

Split binding-stack reachability scanning out of `keymap-dispatch.ts` into a dedicated `keymap-reachability.ts` module. The hot `dispatchKeyEvent` path keeps its early-exit helpers unchanged; only the cold-path scanner and its consumers moved. Restores headroom under the 500-line cap (429 lines).
