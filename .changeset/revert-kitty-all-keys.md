---
"@sma1lboy/rove": patch
---

Rove no longer asks the terminal for the kitty keyboard protocol's "report all keys as escape codes" mode. 0.9.87 and 0.9.88 requested it for the ctrl-hold shortcut guide, and on iTerm2 3.5 typing with a Chinese input method then crashed the whole terminal app. Keyboard handling is back to what it was before 0.9.87; the ctrl-hold guide does not appear until a terminal can report bare modifier keys without that mode.
