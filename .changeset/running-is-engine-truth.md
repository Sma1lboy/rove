---
"@sma1lboy/rove": patch
---

`.running` on `get-task`, `collect` and `read-output` was wrong in both
directions, and both directions cost something.

It read `true` for a task whose engine was reaped hours earlier, because it
asked whether the PTY SESSION was alive and keepAlive keeps that alive on
purpose. It now joins the inventory with a live `ps` walk of each session's
tree — the same predicate delivery gates on — and every tab carries its own
`engineAlive`, so `alive: true, engineAlive: false` names a tab holding a bare
shell. Passing the task's own launch command means a custom engine (a wrapper
script no vendor table knows) still reads as running.

The other direction was the dangerous one: with the pty host merely
unreachable and four engines running, `get-task` and `collect` reported
`running: false` with every tab `alive: false`, and `read-output` warned "no
live terminal session". Connecting to a stopped host succeeds — only the
request fails — and that failure was being swallowed into an empty inventory.
`running` is now `true | false | null`, `alive` and `engineAlive` go `null`
alongside it, and `read-output` reports
`fallbackReason: "pty_host_unreachable"`. `null` means "could not look", never
"nothing is running"; an autonomous cleanup loop acting on the old `false`
would delete worktrees holding live work.

The daemon's engine-death observer also ran only while something was
subscribed to its event channel, which only an attached TUI ever is. Headless
callers therefore got `.activity: null` forever and not one `layer: "engine"`
exit record, however many engines died inside live PTYs in front of them.
Subscribers now choose the CADENCE rather than whether the loop runs: every
tick with one, every ~60s without. A daemon whose host owns no live sessions
still does no per-session work. — [@Sma1lboy](https://github.com/Sma1lboy)
