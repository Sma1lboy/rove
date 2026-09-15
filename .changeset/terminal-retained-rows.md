---
"@sma1lboy/rove": patch
---

Make terminal typing and streaming smoother. Use a 60fps snapshot and render cadence on macOS and Linux as well as Windows, and retain each visible terminal row's text buffer so a changed input line does not rebuild the whole pane. Preserve terminal colors, wide characters, selection, search, and cursor placement.
