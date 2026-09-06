---
"@sma1lboy/rove": patch
---

The owner-only file modes have one owner again. `web-token.ts` and `pty-freeze-store.ts` each kept a private `0o700`/`0o600` pair plus their own copy of the "mkdir's mode is a no-op on an existing path" reasoning, because `owner-only.ts` offered only async tighteners and both of them run synchronously; it now offers sync twins. Nine more bare octals became the named constants, and two exports whose only remaining line was their own declaration are gone.
