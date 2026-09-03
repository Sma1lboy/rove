---
"@sma1lboy/rove": patch
---

Stop serving the web-transport bearer token to unauthenticated callers.

The daemon injected `<meta name="rove-web-token">` into every `GET /`, and
that route is deliberately ungated (a browser cannot attach a bearer header to
the subresources it fetches itself). So any caller that could open the
loopback port — `curl` sends no `Origin`, which the CSRF check permits — read
the credential out of the page body and then drove the whole `/api/*` surface,
including `task.setCommand`, which sets an engine's launch argv. On a shared
machine that reached any other local user, which is exactly the boundary the
token file's 0600 mode exists to hold. Exposure was limited to callers who
could reach the daemon's web port; it was not reachable from a remote network
unless the port had been bound off loopback.

The shell is still served to anyone — it is public build output — but the
token is now echoed back only to a request that already presented it. `rove
web` prints a URL carrying `?token=…` so the first navigation bootstraps, and
the dashboard remembers it for the rest of the browser session, so in-app
navigation and reloads keep working.
