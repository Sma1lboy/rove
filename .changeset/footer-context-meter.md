---
"@sma1lboy/rove": patch
---

The workspace footer now shows how full the active session's context window is — `ctx 62%`, in the same ok/warn/crit tones as the quota chips beside it, suffixed `~` when the figure is the engine's own estimate rather than a number it reports. It answers a different question from the quota chips: not how much budget is left this week, but how much room is left in this conversation, which is the thing that quietly compacts your session away. The number was already engine-computed and already rendered in the browser; the TUI was discarding it. Nothing is summed or guessed in a neutral layer — a vendor that does not report its context window renders nothing rather than a percentage of an invented denominator.
