---
"@sma1lboy/rove": patch
---

Codex tasks launched by Rove start straight at the composer instead of stopping on Codex's startup update menu, which swallowed the first prompt and could install and exit on a routine's or fan-out's Enter. Update Codex with its own installer; a `check_for_update_on_startup` value in your launch-command override is kept.
