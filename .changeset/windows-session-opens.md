---
"@sma1lboy/rove": patch
---

Rove on Windows no longer hangs silently while opening a session. Connecting to the daemon or PTY host had no deadline, and on Windows that address is a named pipe: a connect waits for a free pipe instance instead of failing, so the first probe could hang forever with no output. It now gives up after five seconds and names the address it was waiting on. The guard that refuses to restart a PTY host still holding live sessions also works on Windows now. It used to read the process list through `/bin/ps`, which does not exist on Windows, and counted the failure as zero sessions, so Rove could kill the host and every engine in it. It now reads the list through PowerShell, and if it cannot read the list it refuses the restart instead of assuming zero.
