---
"@sma1lboy/rove": patch
---

Stop `api add`/`send` from silently truncating large prompts, and stop them reporting success when nothing arrived.

A prompt written into an engine that had not yet taken its tty into raw mode was discarded past the tty's 1024-byte canonical buffer — an 8.6KB prompt reached the engine as a 1024-byte prefix, with no error at any layer. Delivery now waits for the engine to announce bracketed paste (DECSET 2004) before writing, which is the engine reporting that it is actually reading. The old fixed 1.5s settle was the specific cause for kimi, which announces at ~1.95s.

`delivered` and `engineReady` are now measured rather than assumed — the spawn path hardcoded both to `true`. A new `promptEcho` field reports whether the prompt's tail was seen echoed back, and `bytes` reports how much was written.
