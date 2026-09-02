---
"@sma1lboy/rove": patch
---

Restore the `setThemeMode` helper that two concurrent changes raced on: one deleted it as unused while the other added its only caller, and main failed to typecheck once both landed.
