---
"@sma1lboy/rove": patch
---

Expire deferred prompts and their Inbox rows after 24 hours, as the policy
always said.

The store documented a 24h TTL, but nothing ever swept: expiry was only
computed inside `deferredPrompt.flush`, which a human reaches by opening
Settings and toggling the composer gate. A prompt the delivery gate parked
because a composer was busy therefore sat on disk forever, and its
`prompt_deferred` Inbox row outlived every later turn on that tab — the
deferred episode has its own lane, so nothing else cleared it.

The daemon now runs the same coordinated record + Inbox cleanup on boot and
hourly, ungated on attached UIs. It expires only: re-delivering a live record
stays a deliberate human action, so a parked prompt is never pasted by a timer.
