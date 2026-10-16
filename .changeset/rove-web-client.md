---
"@sma1lboy/rove": patch
---

`rove --web` serves Rove in a browser. It runs the phone bridge with a web page attached, listens on 127.0.0.1 only, and prints a link that carries its token in the `#fragment`, so the token never reaches a server log. The page shows the Tasks rail (projects, tasks, tabs and the TUI's status marks) and opens any task's terminal session, where you can type, including answering an engine's permission prompt. It takes the bridge's `--port`, `--preset` and `--rotate-token` flags, and phones paired with `rove-bridge` keep working against it. `docs/web/PARITY.md` tracks what the browser still lacks compared with the TUI.
