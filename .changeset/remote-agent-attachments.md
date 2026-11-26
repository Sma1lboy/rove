---
"@sma1lboy/rove": patch
---

A file pasted, dropped or attached for an agent that runs on another machine is now copied to that machine, and the agent is given the path there. Before, the file stayed on this machine and the agent was handed a path it could not open. This covers the web terminal, the web composer, a new session started with its engine on another machine, and a file path dragged into such a terminal in the TUI. The other machine needs this version too: `rove machine update <alias>`.
