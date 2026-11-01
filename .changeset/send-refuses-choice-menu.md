---
"@sma1lboy/rove": patch
---

`send` (and the web composer, which uses it) refuses with `AWAITING_PERMISSION` while the target tab shows an approval or question menu. A send is a paste plus Enter: the menu ignored the text and Enter confirmed its highlighted option, so answering "No" from the composer approved the command, and the typed text was prepended to the next message. Answer the menu with keys, then send.
