---
"@sma1lboy/rove": patch
---

Every session of one user now reaches the same Rove daemon, even when their `XDG_RUNTIME_DIR` differs. On WSL a shell gets `/mnt/wslg/runtime-dir` while an ssh login into the same distro gets none, so the ssh side looked for the daemon somewhere else, decided none was running and restarted it, about once a minute when another machine had this one registered. That knocked out a `rove --web` running in the WSL shell. The daemon and the PTY host now record the socket they listen on next to their pidfile, and a session that finds them alive connects there.
