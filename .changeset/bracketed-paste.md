---
"@sma1lboy/rove": patch
---

Pasting multi-line text into an engine no longer submits it line by line. Rove
now asks the host terminal for bracketed paste (DECSET 2004), so a paste
arrives framed as one event and is handed to the engine as a paste; opentui
knows the markers but never turns the mode on, so the terminal was delivering
pastes as plain keystrokes and every newline read as Enter.
