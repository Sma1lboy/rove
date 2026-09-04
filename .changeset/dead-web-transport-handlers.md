---
"@sma1lboy/rove": patch
---

Remove the HTTP route handlers left behind when the daemon's web transport was deleted.

`src/web/{diff,history,notes,themes}.ts` plus the settings and worktrees route
handlers were wired into the daemon runtime adapter and declared in its
interface, but nothing has called them since the daemon stopped serving HTTP —
their tests passed because they invoked the handlers as plain functions and
never crossed a socket. The harness's theme module fetched `/api/themes`, whose
server was gone, and silently fell back to the static palette on every load; the
palette it fell back to is the one it now uses directly. ADR 0003, which
declared the daemon the owner of that transport, is marked superseded rather
than deleted, so the reason the code was shaped that way survives the code.
