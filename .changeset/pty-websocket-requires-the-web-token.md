---
"@sma1lboy/rove": patch
---

Require the web bearer token on the PTY sidecar, and let the sidecar present
it to the daemon.

The PTY routes were the one part of the web surface the token never reached,
and they are the part that runs commands: `ws /pty` spawns the task's engine or
a shell in its worktree, `POST /pty/send` types into that process, and `POST
/pty/close` kills it. Their only gate was the Origin check, which admits a
request with **no** `Origin` — every non-browser client — and admits **any**
loopback origin, so a page the user happened to have open on another localhost
port could attach as well. WebSocket upgrades get no CORS preflight, so nothing
else stood in the way. Against a running `rove web`, a tokenless upgrade
returned a live shell prompt and a tokenless `/pty/send` typed into it; a wrong
token worked just as well. Exposure was limited to whatever could reach the
sidecar's loopback port — on a shared machine, any other local user, which is
the boundary the token file's 0600 mode exists to hold — and not reachable from
a remote network unless the port had been bound off loopback.

All three routes now require the token that every REST and SSE caller already
sends: the browser puts it on the WebSocket URL the way the `/events` stream
does, and the sidecar refuses an upgrade without it (`401`). The Origin check
stays as defence in depth. The sidecar reads the same `0600` token file the
daemon mints rather than taking the secret from whoever spawned it, so a
launcher that forgot to forward it cannot silently reopen the gap; no readable
file means no request is served.

This also repairs the web terminal, dead since 0.9.60: the sidecar fetches each
tab's launch spec from the daemon's `/api/*`, that route began requiring the
token in 0.9.60, and the sidecar was never taught to send one — so every engine
and shell tab died with `failed to start shell: unauthorized: this request
carried no valid web token` before any PTY was spawned.
