---
"@sma1lboy/rove": patch
---

`add` and `send --tab new` stop reporting a green launch for an engine that never ran.

A hosted session stays alive after its engine exits — the wrapper `exec`s a
login shell in its place — so `pty.open` reports `alive` identically for a
healthy launch and for one pointing at nothing. The argv-delivery path read
readiness straight off that flag:

```json
{ "started": true, "engineReady": true, "delivered": true }
```

for `--command /nope/does-not-exist-engine`, whose session had already printed
`no such file or directory` and `⚠ Engine exited (code 127)`. A fan-out of N
such tasks reported all green. The path now walks for the engine PROCESS
(`awaitEngineProcess`, the one implementation the existing-session gate already
uses) before claiming anything, with a 3s budget, and a launch that produces no
engine fails as `SESSION_FAILED` carrying the task id, the session key and the
session's own last line as `reason`. A repo whose `.rove/init.sh` is still
running reports `engineReady: false` with that stated as the reason instead of
holding `add` open for the install.
