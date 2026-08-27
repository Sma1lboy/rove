---
"@sma1lboy/rove": patch
---

Make `charWidth` the single authority for terminal cell math: a C0 / DEL / C1 control character (a stray escape byte, NUL, or similar) now counts as zero columns instead of one, and the embedded terminal's cursor overlay / row-end seal stop re-flooring zero-width code points back to one cell. A control byte in a task title or `rove export` cell no longer shoves every column to its right out of alignment, and on a line holding a zero-width mark (NFD combining accents, emoji variation selectors, joiners) the cursor overlay lands on the character it's actually over instead of drifting one column right, while an underlined URL reaching the row edge seals its real last column.
