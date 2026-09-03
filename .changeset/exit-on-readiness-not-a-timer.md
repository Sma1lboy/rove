---
"@sma1lboy/rove": patch
---

Quit promptly on SIGHUP/SIGTERM/SIGINT instead of always sitting for five
seconds. The signal backstop used a flat five-second sleep as a stand-in for
"in-flight work has finished", so `kill <pid>` on an idle Rove host took five
seconds — long enough that a supervisor with a shorter grace escalated to
SIGKILL, which skips the exit handler that flushes pending UI state to disk.
The exit now follows a readiness signal that the flows which kill their own
session can hold open, and the five seconds survives only as a ceiling that
says in the log when it fires. Measured on the behavior suite: SIGTERM to
process gone went from ~5,030ms to ~50ms.
