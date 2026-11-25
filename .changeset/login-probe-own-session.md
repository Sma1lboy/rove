---
"@sma1lboy/rove": patch
---

- The terminal UI no longer stops taking keyboard input after startup when an engine is not on `PATH`. Looking that engine up in your login shell briefly took the terminal away from Rove, and a key pressed (or a terminal reply arriving) in that moment broke input until restart.
