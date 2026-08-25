---
"@sma1lboy/rove": patch
---

Centralize the engine package's default vendor fallback. Replace scattered `vendor ?? "claude"` expressions in `engine/interactive-command.ts`, `engine/session-launch.ts`, and `engine/trust-worktree.ts` with `coerceVendorId(vendor)` from `@/types/vendor`. This also fixes a latent edge case: an empty or whitespace vendor string is now treated as "no vendor set" and falls back to `"claude"`, instead of being passed to the engine registry as a literal vendor id.
