---
"@sma1lboy/rove": patch
---

Align the Settings usage dashboard's quota rows by display width instead of character count. A scoped weekly window is labelled with its model display name, and the label column was measured and padded in UTF-16 code units, so a wide-glyph or CJK name (kobe defaults to Simplified Chinese) was sized at half its real width and dragged every meter to its right out of alignment. The column now measures cells, pads to cells, and trims an over-long name on a glyph boundary with a trailing ellipsis instead of a silent hard cut — so "Extremely Long Model Name" reads as "Extreme…" rather than the misleading "Extremel".
