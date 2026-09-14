---
"@sma1lboy/rove": patch
---

A task title no longer keeps an invisible control byte. The title sanitizer already folded C0 controls and DEL to a space so a name arriving over the daemon RPC — `rove add --title`, or an engine rename — couldn't smuggle a `\n` or a raw `\x1b` that the sidebar's width table measures as zero cells and the truncator then never sees; but it missed the C1 block (U+0080–U+009F), where an 8-bit CSI (`\x9b`) or NEL (`\x85`) lands, and `display-width` scores those as zero too — so one could render as a phantom cell and slip past the row-width math the guard exists to protect. The sanitizer now strips the whole non-printing control set — C0, DEL and C1 — matching exactly what the width table counts as zero.
