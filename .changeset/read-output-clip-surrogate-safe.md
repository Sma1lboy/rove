---
"@sma1lboy/rove": patch
---

Clip oversized strings in `rove api read-output` on a character boundary instead of a UTF-16 one. A tool result long enough to be clipped could be cut through the middle of an emoji or other astral character, leaving an orphaned surrogate half that read back as a `�` replacement glyph in the JSON an agent consumes; the same cut now keeps whole characters, and the `[+N chars clipped]` tally counts characters rather than double-counting astral ones as two.
