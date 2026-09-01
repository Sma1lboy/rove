---
"@sma1lboy/rove": patch
---

The selection-across-trim test gave its settle waits a 30-second budget while the test itself kept vitest's 5-second cap, so a loaded CI runner timed the test out underneath its own wait and blocked the 0.9.76 publish. The test now declares a timeout that covers the budget it hands out.
