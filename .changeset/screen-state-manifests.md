---
"@sma1lboy/rove": patch
---

Engines without hooks or transcript markers no longer sit at "unknown": the quiescence poll now classifies the visible screen against engine-declared rules (working / blocked / idle), so copilot tabs — and kimi sessions before hooks are approved — show real working and needs-input badges. Hooks remain the first authority; the screen read is the fallback layer.
