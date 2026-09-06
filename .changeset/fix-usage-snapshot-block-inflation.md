---
"@sma1lboy/rove": patch
---

Fix inflated token totals for Claude tasks. The session usage snapshot — the numbers behind the footer's token chip and the settings usage dashboard — summed usage once per transcript record, but Claude Code writes one record per assistant content block (thinking, tool_use, text) and stamps the same usage on each, so a single reply counted its cost two or three times over. Usage is now folded per assistant message id, so each message counts once; the reported context window (the last prompt's size) is unchanged.
