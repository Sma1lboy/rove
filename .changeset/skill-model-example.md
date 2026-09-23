---
"@sma1lboy/rove": patch
---

**The rove agent skill shows model pinning as the user's own id** — its `--model` example passes the id exactly as the user wrote it instead of a fixed `claude-fable-5`, matching the skill's own "pass it verbatim" rule (skill version 51; `rove skill install` refreshes it).
