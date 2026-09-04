---
"@sma1lboy/rove": patch
---

`rove doctor` now reports processes that outlived the PTY session that spawned them, and `--kill-orphans` reclaims them.

Rove ends a session by signalling the child's whole process group, so a normal
close takes the shell, the engine, and everything they spawned with it. Nothing
covered the case where the kill comes from OUTSIDE Rove — a `kill -9`, an OOM
reaper, a crashed PTY host — because then Rove is never told and never signals
the group, and the engine's children run until you reboot. One developer machine
had eight of them, aged two to five days, still burning CPU.

Doctor lists a process only when it carries the marker the PTY host sets on every
child, its parent is init, its process group has no leader left, and that group is
not one the PTY host still reports as live — so a healthy task, and anything
started outside Rove, can never appear. Killing is a separate `--kill-orphans`
flag rather than a `doctor --fix` entry, because a dev server you backgrounded
from a Rove terminal and then closed the tab on looks exactly like a leak.
