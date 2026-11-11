---
"@sma1lboy/rove": patch
---

A task on another machine now runs its agent on this machine by default, with only its files and commands on that one, so that machine needs no engine installed or signed in. `rove api add --machine <alias>` and the web New task composer both do this. In the composer the engine, model and effort are this machine's, and an `Engine there` chip next to the machine runs the engine on that machine as before; on the command line that is `--engine-there`. Requests the new mode cannot serve (`--count`, `--agents`, `--fork`, `--worktree-only` and a Windows machine among them) still run on that machine. In the web sidebar such a task sits under its project.
