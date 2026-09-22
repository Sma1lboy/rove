---
"@sma1lboy/rove": patch
---

Cycling the notification chime volume no longer skips a level when the stored value doesn't sit exactly on a step. Settings → General → Sound steps through 0.1 → 0.25 → 0.4 → 0.6 → 0.8 → 1, and from a value that landed between two of them — a hand-edited `state.json`, or an older float that predates the step list — the row jumped two steps at once and, from 0.9, wrapped straight back to the quietest instead of reaching full volume. It now advances to the next louder step every time, wrapping to the quietest only once you're at the top. Values already on a step are unchanged.
