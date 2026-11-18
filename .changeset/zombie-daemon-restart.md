---
"@sma1lboy/rove": patch
---

Restarting Rove no longer leaves it unable to start. If the old background process had exited but the program that launched it never collected it, every new start was refused with "already served by the daemon" until that program quit. Such a leftover now counts as stopped.
