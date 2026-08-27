---
"@sma1lboy/rove": patch
---

`rove doctor` now reports whether the engine hook channel is actually live.

Hooks are the only sub-second path to the sidebar badge, and they fail
silently by contract: `rove hook` never spawns a daemon, always exits 0, and
swallows every error. When an engine tab holds a stale daemon socket path,
every hook drops its event and the badges quietly fall back to the activity
observer's ~10s poll — so the UI looks sluggish rather than broken. Doctor
reads the activity entries the daemon already records and reports one of four
states: the channel is live, no hook events are arriving at all, there are no
engine tabs to judge, or the registry could not be read. The failure case
prints the resolved socket path plus how to read an engine tab's own.
