---
"@sma1lboy/rove": patch
---

Stop publishing the `@sma1lboy/kobe` compatibility alias.

Releases shipped the CLI under both names through the rename. The old name is frozen at 0.9.64: an existing install keeps working and its update check reports the newest `@sma1lboy/rove`, but new versions are published under the canonical name only. Reinstall as `@sma1lboy/rove` to keep receiving updates.
