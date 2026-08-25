---
"@sma1lboy/rove": patch
---

Harden the `daemon.status` wire-shape test. Replace weak `typeof` checks on `uptimeMs` and `kobeVersion` with concrete assertions: `uptimeMs` must be non-negative and `kobeVersion` must equal the runtime's current version.
