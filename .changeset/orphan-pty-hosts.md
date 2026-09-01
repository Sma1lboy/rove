---
"@sma1lboy/rove": patch
---

Stop test and harness PTY hosts outliving the run that created them.

A PTY host stays alive while it owns a live session, and the daemon's
`PtyLiveHold` chains off the same fact. When a harness run died between
`dev:sandbox:reset` and its `rm -rf`, the socket and pidfile went with the
fixture home while the host kept idle shells running — leaving a process with
no address anyone could reach it on. Twenty-five accumulated on one machine,
the oldest over two days.

Two fixes. The host now watches its own pidfile and exits when it no longer
names it: deleted, or claimed by a successor. Possession of its address, not
age and not the process table, so `rove daemon restart` and an attached
`dev:sandbox` are untouched. And `stopDaemonProcess` no longer unlinks a
socket and pidfile belonging to a process that is still alive — the race that
erased a live host's address in the first place.

Visual-fixture teardown now records the daemon and PTY-host pids before it
deletes their home and fails loudly if either survives, instead of deleting
the evidence. Fixture hosts also carry a 30-minute lifetime ceiling
(`ROVE_PTY_MAX_LIFETIME_MS`) for the run that never reaches teardown at all;
it is deliberately unset in production.
