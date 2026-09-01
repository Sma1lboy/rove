---
"@sma1lboy/rove": patch
---

Add a switch that turns off the composer check before prompt delivery (Settings → Dev).

Before pasting a peer or API prompt into a running engine, Rove renders that session's screen and holds the message when the composer already has text in it. That check reads the engine's current on-screen layout, so a vendor redesign can make it confidently wrong — as one did, holding every message to every Claude task while their composers sat empty.

The detector was fixed, but the failure mode returns whenever an engine moves its UI, and until now there was no way to say "I can see it's empty, send it". Turning the switch off drops the screen read only: the recent-keystroke guard stays on, so a composer someone is actively typing into is still protected — that one measures time rather than parsing a layout, and cannot go stale.

On by default. Documented under Troubleshooting for the symptom that leads to it.
