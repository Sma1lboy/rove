---
"@sma1lboy/rove": patch
---

Stop the daemon disconnect/reconnect loop caused by a socket guard that deleted a healthy daemon's files.

A daemon whose socket path was clobbered between bind and `arm()` never recorded an ownership stamp, and shutdown treated "never armed" as "still mine" — unlinking the socket **and pidfile** of whichever daemon owned the path by then (both node and Bun unlink a unix socket by path inside `server.close()`). The missing pidfile then blinded the busy-daemon grace in `ensureDaemonReachable`, which keys on `readPidFile`, so every client skipped the grace and went straight to stop+spawn. That fed itself: 293 autospawns and 23 takeovers in one window, cycling every 5-16 seconds with all attached clients dropping together.

Ownership cleanup now fails closed — socket and pidfile are removed only on proven ownership (armed, and the inode still matches). The guard is also armed immediately after `listen`, so no `await` sits in the window where a usurper could unlink or rebind the path.
