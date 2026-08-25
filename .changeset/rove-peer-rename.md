---
"@sma1lboy/rove": patch
---

Agent-to-agent message provenance renames to the product: peer prompts now arrive prefixed `[ROVE PEER]` and forwarded field notes `[ROVE FIELD NOTE]` (previously `[KOBE PEER]`/`[KOBE FIELD NOTE]`). The prefixes are read by agents, not parsed by code, so there is no compat shim; the skill guidance ships in lockstep (v32).
