---
"@sma1lboy/rove": patch
---

Internal: remove five code paths that still called the daemon's HTTP transport, deleted in #855.

The PTY sidecar's launch-spec resolver still had a branch that fetched `/api/engine-spec` and `/api/terminal-spec` on port 45174 — routes with no listener since the daemon became socket-only. Every runner set `KOBE_PTY_DEV_COMMAND` and returned before reaching it, so the dead branch stayed green through CI. It now throws by name when that variable is unset, instead of resolving `undefined` into a `TypeError` deep in the session manager and presenting as a blank terminal with no cause.

Also gone: the `engineSpec`/`terminalSpec` runtime-adapter chain those routes were the only consumers of, `DaemonDirectLink.snapshot()` (the half of the in-process link that belonged to the deleted dashboard), the three unreferenced verifiers in the daemon's web-token module, and the harness's browser REST client for the removed API. Comments and log strings naming `rove web`, the browser dashboard's prompt composer, and the daemon's `/api/*` routes now describe what is actually there.
