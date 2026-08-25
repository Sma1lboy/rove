---
"@sma1lboy/rove": patch
---

Centralize the engine package's default vendor fallback. Replace scattered `vendor ?? "claude"` expressions in `engine/interactive-command.ts`, `engine/session-launch.ts`, and `engine/trust-worktree.ts` with `coerceVendorId(vendor)` from `@/types/vendor`. No behavior change — the fallback remains `"claude"` for undefined vendors.
