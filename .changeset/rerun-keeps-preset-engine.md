---
"@sma1lboy/rove": patch
---

[web] [ios] Retry, Run again and Change engine on a session started with a custom engine such as `claudecpa` now open on that engine. Before, they opened on the built-in engine it is based on, so Retry and Run again started plain `claude` and made it the default engine for the next new session.
