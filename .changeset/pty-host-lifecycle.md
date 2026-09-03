---
"@sma1lboy/rove": patch
---

**Three PTY host lifecycle fixes.**

- **A closed tab stays closed.** `kill()` dropped the session's freeze record synchronously and then awaited the child's exit — and the exit handler force-wrote the same record straight back, with a fresh timestamp that outlived the 14-day prune. The next pty-host incarnation resurrected sessions the user had closed (or that a task deletion had killed), `rove doctor` listed them, and opening one replayed the closed session's old scrollback instead of spawning fresh. The freeze writer now honours the same "closed by request" flag the death record already did.
- **An engine death fires once.** The exit watcher tracked seen records by the session key while the store writes engine-layer records under `<key>#engine`, so its prune dropped each engine record on the sweep that created it and every later sweep re-fired the same death — duplicate `session.exited` plugin events, and an Attention Inbox episode the user had read popping back to unread whenever anything else touched `pty-exits.json`.
- **`rove doctor` reports parked tabs again.** A socket closing cleared the parked bookkeeping of every session in the host, not just the ones it was attached to — and the daemon's own liveness poll opens and closes such a socket every 15 seconds, so the parked count and parked screen bytes read `0` however many tabs were actually parked.
