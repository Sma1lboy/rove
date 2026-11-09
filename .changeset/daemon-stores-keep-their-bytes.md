---
"@sma1lboy/rove": patch
---

A daemon store that failed to save keeps the change and retries it; an `automations.json` or `agent-turns.json` that cannot be read is kept aside as `.corrupt-<ts>` instead of being replaced by an empty file; the plugin registry is written atomically.
