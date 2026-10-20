---
"@sma1lboy/rove": patch
"@sma1lboy/rove-plugin-sdk": patch
---

New plugin event `agent.rate-limit-recovered`: it fires once when a rate-limited task completes its next turn, carrying when the limit began (`limitedAt`) and how long it lasted (`limitedForMs`). A resumed turn that hits the limit again does not count, so a hook on this event runs only when work is actually flowing again.
