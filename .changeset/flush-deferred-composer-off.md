---
"@sma1lboy/rove": patch
---

Flush queued peer and API prompts when the composer screen check is turned off.

Rove now retries every deferred prompt in insertion order after the setting is durably disabled. Successful deliveries clear their Inbox entries; a busy, temporarily unavailable, or failed tab keeps its prompt queued and visible while later tabs continue. Explicitly closing a tab discards its queued prompt and clears the stale Inbox entry.
