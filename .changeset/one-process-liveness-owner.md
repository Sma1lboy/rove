---
"@sma1lboy/rove": patch
---

Stop producing the torn pidfile that made `isProcessAlive`'s pid-`0` guard necessary. Both the daemon's and the PTY host's pidfiles were written with a plain `writeFile`, which truncates before it writes, so an interrupted write left an EMPTY file — and `Number("")` is `0`, the pid `kill` reads as the caller's own process group. They now go through tmp+rename like every other file-backed store in the daemon, `readPidFile` refuses any implausible pid instead of passing it on, and `stopDaemonProcess` has coverage proving it signals nothing for a torn pidfile.
