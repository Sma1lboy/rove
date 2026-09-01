---
"@sma1lboy/rove": patch
---

Fix the delivery gate deferring every message to a Claude task, whatever its composer held.

Before pasting a prompt into a running engine, Rove renders that session's screen and looks for an empty composer. Two things had drifted: the throwaway terminal was 12 rows, too short for a real screen — rows overflowed and FUSED, so the composer line no longer existed to match — and Claude now hangs a rule, a status row and a hint row below its composer, putting the prompt four lines from the bottom, outside the two-line window the rule inspected.

A rule that matched nothing was then read as "the composer has text", so every `rove api send` to a Claude task was accepted-and-deferred to the Inbox instead of delivered.

The window now clears Claude's status furniture, the render is tall enough not to fuse rows, and — the part that keeps this from recurring silently — a rule whose anchor is nowhere on screen now answers "I can't see it" rather than "there is text". Not seeing the composer leaves the recent-human-write quiet period as the guard, instead of blocking delivery to that engine indefinitely with no signal.
