---
"@sma1lboy/rove": patch
---

`rove update` works on Windows. The updater spawned bare `sh`, which a default Git for Windows install does not put on `PATH` — only `…\Git\cmd` is added, while `sh.exe` lives in `…\Git\bin` — so both the CLI and the TUI's update chip died with a raw `spawn sh ENOENT`, leaving `npm install -g` by hand as the only route. The updater now runs the install script through the same Git Bash every engine and terminal tab already launches through, and a missing one is reported as "install Git for Windows" with the manual command, instead of an ENOENT naming a shell.
