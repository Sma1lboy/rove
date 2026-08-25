---
"@sma1lboy/rove": patch
---

Unify the gated tool-hook verb set across engine adapters. Move the `tool-pre` / `tool-post` / `tool-failed` constant from `json-hook-adapter.ts` and `kimi-local/hook-adapter.ts` into a single `GATED_TOOL_VERBS` export in `json-hooks.ts`. No behavior change.
