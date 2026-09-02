---
"@sma1lboy/rove": patch
---

Flush queued peer and API prompts when the composer screen check is turned off.

Rove now retries every deferred prompt in insertion order after the setting is durably disabled. Each record is claimed before exact-engine-tab delivery, and a durable delivered marker prevents a failed Inbox cleanup from sending it twice. Concurrent flush, Inbox release, dismiss, and tab-close operations converge without duplicate delivery; expired records clean their Inbox pointers.

A busy, temporarily unavailable, or failed tab stays queued while later tabs continue. Re-enabling the check synchronously cancels the remaining flush, an older daemon that lacks the flush verb produces an on-screen warning, and both attached-TUI and headless tab closing discard the tab's queued prompt.
