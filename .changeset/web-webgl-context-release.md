---
"@sma1lboy/rove": patch
---

Web: a page left open while you switch between many tasks no longer runs out of WebGL contexts. A terminal disposed after it leaves the park cache now releases its GPU context right away; before, the context lived until garbage collection, so after a few dozen switches the browser hit its ~16-context cap and started killing the oldest ones, which could belong to a terminal still in use.
