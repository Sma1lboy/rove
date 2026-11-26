---
"@sma1lboy/rove": patch
---

After a reboot, less is left for you to do. Opening a tab of a task on another machine now reopens its session there by itself, as a local tab already did, including when its saved screen had expired; before, it showed "this tab has no running session" until you pressed Reopen session. And `rove daemon autostart on` starts the daemon, resident, every time you log in (a systemd user unit on Linux, a launchd agent on macOS, a sign-in entry on Windows), so a machine that restarted is reachable again without anyone opening Rove on it. `rove daemon autostart off` undoes it.
