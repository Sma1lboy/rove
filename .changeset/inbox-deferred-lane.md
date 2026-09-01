---
"@sma1lboy/rove": patch
---

Stop a deferred prompt's Inbox entry from being erased by the target's own activity.

When the delivery gate holds a message, the daemon stores the text and files a `prompt_deferred` Inbox episode — the only pointer to that stored prompt. The Inbox keeps one episode per task+tab and every write clears that slot first, so the moment the target agent started or finished its next turn, the episode was dropped and the stored message became unreachable: retained on disk for its 24h TTL, released by nothing.

`prompt_deferred` now occupies its own lane, so engine activity and a held message coexist. A newer deferral still replaces an older one for the same tab (the store keeps one prompt per tab either way), and releasing from the Inbox still clears both.
