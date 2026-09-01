---
"@sma1lboy/rove": patch
---

Removed dead code with no remaining callers: the Solid-era `tui/component/border.ts`
presets, the unused `tui/history/mock-fixtures.ts` transcript fixtures, `allModels()`
in the engine registry, and `startOpsPreview()` (the entrypoint for a `rove ops --preview`
subcommand that no longer exists). No user-visible behavior changes.
