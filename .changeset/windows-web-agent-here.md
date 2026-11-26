---
"@sma1lboy/rove": patch
---

Starting a session on a Windows machine from the web now also keeps the agent on this machine, as `add --machine` does: the web bridge no longer sends every Windows start to that machine's own engine.
