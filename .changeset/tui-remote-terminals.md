---
"@sma1lboy/rove": patch
---

The TUI opens the terminals of a task on another machine. Selecting it shows that machine's tabs, polled from it, and attaches the active one to that machine's live session over the forwarded socket. You watch and type as on a local tab. The usual tab keys cycle and jump; prefix t opens a new tab and ctrl+w closes one, both on that machine. Nothing is spawned on this machine for a remote task. While the machine is unreachable the workspace says so.
