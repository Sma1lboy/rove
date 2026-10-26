---
"@sma1lboy/rove": patch
---

Switching between sessions on the web no longer blanks the terminal while it reattaches. A terminal you switch away from stays alive in the background, still taking output, and comes back at once; the eight most recently shown are kept. An older one shows its last screen while it reattaches, until the engine has redrawn.
