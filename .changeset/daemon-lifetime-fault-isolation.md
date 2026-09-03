---
"@sma1lboy/rove": patch
---

Fixed three ways the daemon could be stranded alive by a single failure. A browser SSE connection whose hydration snapshot threw left a gui behind that nothing could subtract, so the daemon never idle-exited after the TUI quit and every collector kept polling npm, git and gh for a browser that had received a 500 — the snapshot is now assembled before the refcount is acquired. A shutdown that threw partway (the plugin host's `stop()` is the known thrower) skipped the release half entirely, leaving the socket and pidfile on disk in front of a daemon that still answered `hello` but whose panes never updated again; the release now runs in a `finally`. And a rejecting stop hook took `daemon.stop`, idle-stop and socket-takeover down with it while `stopping` stayed latched, so `rove daemon stop` reported success and the process kept running — the teardown is now scheduled regardless.
