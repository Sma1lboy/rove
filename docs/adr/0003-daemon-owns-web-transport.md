# ADR 0003 - The daemon owns the web transport

- Status: superseded by #855 (2026-09-03)
- Date: 2026-06-18

## Context

`kobe web` used to reach daemon state through a standalone `kobe-web/server`
bridge. The browser talked HTTP/SSE to the bridge, and the bridge talked
JSON-lines to the daemon socket. That shape was useful while the dashboard was
moving fast: web route code could hot-restart without touching the daemon, and
the daemon did not need to expose browser-facing routes.

The module has become shallow. Its interface is almost as large as its
implementation: it owns the HTTP route table, daemon socket subscription,
allowed RPC forwarding, SSE snapshot fan-out, session launch specs, notes,
diffs, themes, issue asset routes, and static hosting. The deletion test says
the complexity would reappear in every web host unless the daemon becomes the
HTTP/SSE seam.

## Decision

The daemon is the owner of the local web transport. Browser and desktop front
ends talk directly to a daemon-hosted loopback HTTP/SSE interface for
daemon-backed data and mutations. The `kobe-web/server` bridge is not a product
seam.

The target shape is:

- `kobe daemon` exposes local HTTP RPC plus event streaming for the same
  daemon-owned channels and mutations it already owns on the socket protocol.
- The web SPA and desktop shell use that daemon interface directly.
- Vite remains a dev-only static asset/HMR host and may proxy to the daemon in
  development.
- The PTY sidecar remains a Node adapter while `node-pty` requires Node, but
  its lifecycle and launch-spec requests route through the daemon interface.
- The legacy bridge code may remain temporarily as dead compatibility source,
  but new daemon-backed browser routes must be added to the daemon interface.

## Consequences

- The chain shortens from `SPA -> bridge -> daemon socket` to
  `SPA -> daemon HTTP/SSE`, improving locality for daemon state bugs and making
  request tracing easier.
- Web safety checks (loopback bind, Origin/token policy, RPC allowlist, event
  channel filtering) move to one daemon-owned interface instead of living in a
  separate adapter.
- Hot-reload convenience is no longer a reason to keep daemon-backed behaviour
  outside the daemon. During development, Vite can reload the SPA while the
  daemon interface stays stable.
- The old bridge adapter should not be wired into dev, desktop, CLI, or package
  builds. Static hosting, dev proxies, PTY launch specs, RPC, and SSE all point
  at the daemon web transport.

## Superseded

PR #855 deleted the browser dashboard, the daemon's HTTP/SSE transport, and
`rove web`. The daemon now speaks only its unix socket:

```
git grep -nE "Bun\.serve|createServer|node:http" -- packages/kobe-daemon/src
# → only node:net, in server.ts and pty-server.ts
```

The decision above was really taken and really shipped — the bridge did move
into the daemon — so this record stays. What no longer holds is its standing
instruction that "new daemon-backed browser routes must be added to the daemon
interface": there is no daemon HTTP server to add a route to. A contributor
following that clause would write a handler nothing can reach, which is exactly
what happened to `src/web/{diff,history,notes,themes}.ts` and the
`settings`/`worktrees` route handlers — wired into the runtime adapter,
declared in its interface, and called by nobody until they were removed.

The one surviving piece of this shape is the PTY sidecar, which is a Node
process with its own HTTP/WebSocket listener and its own bearer-token gate
(`packages/kobe-harness/pty-auth.mjs`). It is not the daemon web transport and
does not revive it.

The successor decision is implicit in #855 and has no ADR of its own: the TUI
is the product, the daemon socket is the only daemon interface, and
`/harness` is a capture page, not a dashboard.
