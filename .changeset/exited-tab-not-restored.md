---
"@sma1lboy/rove": patch
---

A task whose engine is running no longer turns red (error dot) because of a terminal tab that had already finished before the PTY host restarted. Only sessions the host's death cut short come back as "restored"; a child that exited on its own stays an ordinary finished tab, and a graceful host shutdown no longer records the children it ends as exits.
