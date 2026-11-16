---
"@sma1lboy/rove": patch
---

The web client's New session draws its engine and model chips at once instead of waiting for the engine list each time: it reuses the list the page read when it opened and the one from the last visit. A composer restored by a page reload no longer stays without those chips.
