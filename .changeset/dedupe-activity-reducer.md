---
"@sma1lboy/rove": patch
---

One activity state machine instead of two copies

The reducer that decides a task's engine-activity badge (the ● lamp, the ?
attention badge) existed twice — once in `kobe/src/engine/hook-events.ts`, once
in `kobe-daemon/src/daemon/activity-reduce.ts` — with the daemon copy carrying
a `// Mirrors kobe's hook-events reducer.` note asking readers to keep them in
step by hand. Both copies also recorded the same two production bugs, which is
what a copy that has already drifted once looks like.

The daemon copy is now the only definition (kobe depends on kobe-daemon, never
the reverse; the daemon's activity registry is the reducer's only production
caller), and `hook-events.ts` re-exports it. Every comment that a real incident
paid for is preserved at that one definition: Kimi firing Interrupt instead of
Stop, a Stop landing on a cold registry after a daemon restart, and the
automated wake that used to light the ● lamp for a turn nobody started.

No behavior change. The daemon's own tests now pin the cold-registry
completion and the Kimi interrupt through the registry — before this, breaking
either one left the daemon-path tests green.
