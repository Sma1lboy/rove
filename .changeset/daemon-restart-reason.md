---
"@sma1lboy/rove": patch
---

An action taken in the web client while the daemon is restarting (deleting a task, opening a tab) now waits for the daemon to come back and goes through, instead of failing with `connect ENOENT …/daemon.sock`. If the daemon stays away, the error says so in words, and `rove api` reports it as `DAEMON_UNREACHABLE`.
