---
"@sma1lboy/rove": patch
---

Wrapped engine presets now get the protocol's context usage, composer gate, turn detector and title hint

A custom preset (`engineProtocol.<id>`) declares which built-in adapter Rove speaks to it with, but five reads still keyed off the raw preset id and so landed on the registry's EMPTY custom entry. On a `claudecpa` task that meant: no token/context chip in the footer, no per-turn telemetry, no composer-busy gate (so `rove api send` pasted over half-typed text instead of deferring), no turn detector, and a title hint that answered `null` forever — leaving the ESC interrupt observer unable to see working→rest.
