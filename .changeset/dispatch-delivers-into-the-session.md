---
"@sma1lboy/rove": patch
---

`rove api dispatch` now delivers the text instead of hoping somebody else does.
The verb published on the daemon's `session.deliver` channel and returned
`{ ok: true, clients: N }`; the only subscribers were the browser SPA, so
dispatching into a TUI-hosted task exited 0 with the prompt going nowhere — an
agent answering a stranded permission prompt got a success and a task that
stayed stuck. The daemon now pastes into the task's live hosted engine session
through the same adapter `send` uses (never spawns, respects each engine's
composer gate) and reports what happened: `delivered: true` with the `tabId`
that took it, `delivered: false, reason: "busy"` when a human is mid-message and
nothing was written, or `delivered: false, reason: "broadcast"` when no hosted
session answered and the event went out for a browser to pick up. Only that last
case still broadcasts — publishing after a successful paste would make a
listening browser paste the same text twice.
