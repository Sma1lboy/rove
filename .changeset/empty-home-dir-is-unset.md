---
"@sma1lboy/rove": patch
---

An empty `ROVE_HOME_DIR` / `KOBE_HOME_DIR` now means "unset" instead of a home of `""`. Read raw, it made every state path relative to whatever the process's current directory happened to be — `homeDir()` returned `""`, `roveStateDir()` returned `.rove`, and `defaultDaemonPidPath()` returned `.rove/daemon.pid`. For the TUI that directory is the user's repository, so a `VAR=`-style clear (how a shell says "unset") could have written Rove's state into the repo it was working in.

The daemon's own `resolveDaemonHomeDir` already guarded this; every other accessor did not. All of them now read the variable through one guard, which also fixes a second edge: an empty `ROVE_HOME_DIR` used to shadow a set `KOBE_HOME_DIR` and send the caller to the OS home instead of the legacy one.
