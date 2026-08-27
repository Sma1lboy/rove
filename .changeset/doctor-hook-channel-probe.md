---
"@sma1lboy/rove": patch
---

`rove doctor` now reports whether the engine hook channel is actually live.

Hooks are the only sub-second path to the sidebar badge, and they fail
silently by contract: `rove hook` never spawns a daemon, always exits 0, and
swallows every error. When an engine tab holds a stale daemon socket path,
every hook drops its event and the badges quietly fall back to the activity
observer's ~10s poll — the UI looks sluggish rather than broken. Doctor reads
the activity entries the daemon already records and says so, naming a
`*_DAEMON_SOCKET_PATH` override when one shadows the live socket.
