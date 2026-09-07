---
"@sma1lboy/rove": patch
---

Keep the daemon and the PTY host alive when Rove quits on Windows. Quitting the TUI, closing its terminal tab, or letting a `rove daemon restart` finish used to take every engine tab with it: on Windows, Bun puts each spawned child in a kill-on-close job, so the daemon and the PTY host died the moment the process that started them exited, and with a log file on their stdio they were also left sharing the terminal's console, so a Ctrl+C or a closed tab reached them too. Both are now spawned through a small PowerShell launcher that creates the child broken away from the job, on its own hidden console, with stdout/stderr still appended to `daemon.log` / `pty.log`. Engine tabs survive quitting and restarting Rove on Windows the way they always have on macOS and Linux. If the launcher cannot run, the old direct spawn is used and the log says so.
