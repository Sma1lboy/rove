---
"@sma1lboy/rove": patch
---

Require a bearer token on the daemon's web transport

The browser-facing HTTP/SSE routes were gated only by an Origin check, which is
a CSRF control rather than an authentication one: browsers send `Origin`
automatically, but a request without it was allowed by design, so any local
script could reach the 22 web-exposed RPCs — including `task.setCommand`, which
sets an engine's launch argv. Every request now also has to present a token
kept `0600` in `<ROVE_HOME>/.rove/web-token`; the dashboard receives it in the
served HTML. Rotate by deleting the file and restarting the daemon.
