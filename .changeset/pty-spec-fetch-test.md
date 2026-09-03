---
"@sma1lboy/rove": patch
---

`rove doctor` no longer lists `KOBE_TEST_ENGINE` in its environment dump — no
code has read that variable in either package, so the report was naming a knob
that does nothing.

Behind that, the PTY sidecar's daemon spec fetch moved into its own module so a
test can reach it. Every runner that touches the sidecar sets
`KOBE_PTY_DEV_COMMAND`, which returns before the daemon hop, so the route
choice, the bearer token and the error shaping were unexercised — that gap is
how a web terminal broken from 0.9.60 to 0.9.102 passed roughly forty CI runs.
