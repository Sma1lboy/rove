---
"@sma1lboy/rove": patch
---

A session whose workspace is on another machine now knows which machine runs what. `rove` commands in its Bash run here, so `rove api send --prompt-file -` and `--repo /Users/…` work from a Windows workspace. `rove machine mcp <alias> <name> <url>` forwards that machine's MCP servers, such as its browser, into the session as `<name>-<alias>`. `list` and `get-task` name the machine and path, and the TUI and web sidebars mark the row with the machine's cloud.
