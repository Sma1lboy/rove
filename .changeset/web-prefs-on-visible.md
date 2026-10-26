---
"@sma1lboy/rove": patch
---

Web: a phone coming back to the page picks up a theme, light/dark mode or language changed elsewhere (the TUI, another browser) without a reload. Settings were re-read only when the window got focus, which a phone returning to the tab doesn't always fire.
