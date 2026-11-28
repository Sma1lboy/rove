---
"@sma1lboy/rove": patch
---

[web][ios][daemon] Opening a session on the phone no longer narrows its terminal. The phone used to resize the shared terminal to its own width, so tables and boxes an agent had drawn wide wrapped into a mess, on the phone and on the computer showing the same session. The phone now keeps the terminal's size, shows it fitted to the screen width, and zooms in with a pinch or a double tap; drag to look around while zoomed in. When the computer resizes the terminal, the phone follows.
