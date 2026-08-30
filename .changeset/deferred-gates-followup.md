---
"@sma1lboy/rove": patch
---

Internal: split the daemon composition root (`server.ts`) into a `stores.ts` store-wiring module and add render-track coverage for the deferred-prompt inbox exit path and deferral toast. No user-visible behavior change — completes the CI gates for the issue #78 B layer.
