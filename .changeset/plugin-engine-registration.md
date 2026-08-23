---
"@sma1lboy/rove": patch
---

Plugins can now contribute engines: a `[[engines]]` table in rove-plugin.toml declares a coding CLI's id, name, launch command, and screen-state rules — it appears in the engine selector, launches like any engine, and gets screen-based working/needs-input badges. Built-in engine ids can't be shadowed.
