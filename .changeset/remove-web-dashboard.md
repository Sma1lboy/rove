---
"@sma1lboy/rove": patch
---

Remove the browser dashboard and the `rove web` command.

The TUI is the product. The dashboard was a second UI over the same daemon,
and keeping the two in step cost more than the browser surface returned — so
it is gone, along with the daemon's HTTP/SSE transport that served it and the
`ROVE_DAEMON_WEB_PORT` / `ROVE_WEB_HOST` settings that configured it. There is
no longer a way to reach Rove from a browser; the TUI, `rove api`, and the
daemon socket are the interfaces.

What stays is `/harness`: the page that runs the real OpenTUI over a PTY and is
the ground-truth surface for visual acceptance. It no longer depends on any of
the deleted code — the same fixture screenshot is byte-identical before and
after this change.

The daemon's in-process RPC link survives too, under its own name now
(`daemon/direct-link.ts`). It never belonged to the browser: the automation
runner uses it to launch engine sessions whether or not anyone is watching.
