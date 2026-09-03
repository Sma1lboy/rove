---
"@sma1lboy/rove": patch
---

Engine display names now come from one place. `humanizeSlug` was implemented twice (settings model and the daemon settings adapter) and `engineLabel` was a third derivation of the same answer; the registry-backed `engineDisplayName` in `engine/interactive-command.ts` owns it now, and the hard-coded `"claude"` fallbacks in the adapter and `add` handler read a named `DEFAULT_VENDOR`. No user-visible change — the daemon settings snapshot is byte-identical.
