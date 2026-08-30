---
"@sma1lboy/rove": patch
---

Engines declare their own fork verb, and `rove doctor` lists every engine

Forking a chat was gated on a hardcoded `claude || codex` list, so an engine
that ships a fork verb could not fork until someone edited a shared file, and a
custom preset declaring a built-in protocol was refused despite launching that
exact binary. The verb is now declared by each engine and resolved through the
preset's protocol, like its session-id flags.

`rove doctor` listed three hardcoded engines, so Kimi never appeared even
though Rove detects its login, and no engine you added could show up at all.
Doctor now loops over the registered engines, and an engine whose login Rove
cannot read says so instead of reporting a missing account.
