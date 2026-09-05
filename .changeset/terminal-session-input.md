---
"@sma1lboy/rove": patch
---

Clear terminal search and selection when switching sessions so a previous tab's query cannot capture input intended for the new tab. Keep the original terminal process and buffered output when returning to a tab. Route pasted text into the focused scrollback query while search is open, and restore normal terminal paste when it closes.
