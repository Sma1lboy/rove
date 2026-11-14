---
"@sma1lboy/rove": patch
---

Web: a terminal no longer goes blank or shows wrong characters after a long session. Once enough distinct coloured characters had been drawn (pasted images get there fastest), the terminal's renderer began failing on every frame and stopped painting text, and a terminal in the background could come back with other characters in place of its own. Reloading the page was the only way out.
