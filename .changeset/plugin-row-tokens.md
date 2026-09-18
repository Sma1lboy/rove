---
"@sma1lboy/rove": patch
---

Plugins can put a label on a task row. `rove api row-token` (SDK: `setRowToken()` / `clearRowToken()`) writes one short token into the plugin's own slot on a task's sidebar/board row, and every token carries a TTL — default 60s, max 1h — so a plugin that dies has its labels fade instead of leaving stale state on screen. A plugin owns its text, its slot and a semantic `tone`; the derived group, the activity badge, the PR chip, the title and the branch stay host-owned. Closes the last plugin-SDK gap from the herdr audit (item 8), with a runnable `examples/row-tokens/` and the contract in docs/PLUGIN-AUTHORING.md.
