---
"@sma1lboy/rove": patch
---

Bound the `ps` probe that every engine-presence check runs, and stop a failed probe from reading as "no engine".

`psSnapshot` awaited `ps -A` with no deadline and no kill. Every caller wraps the probe in try/catch, which catches a throw and never a hang, so a `ps` that did not exit froze whichever gate asked it — including prompt delivery, which sits between a deferred prompt's `beginDelivery` marker and its release. It now gives up after 5s (`ps -A` answers in ~20ms) and kills the child rather than leaving it holding a pipe nobody reads.

Failure is also an answer now. `enginePresence` reports `"engine" | "none" | "unknown"`, and `send` refuses an unreadable probe with `ENGINE_PROBE_FAILED` instead of telling you a running tab "has no live engine process — it is a plain shell right now". The write gate itself is unchanged: `sessionHasEngine` still refuses on anything but a positive walk, because a prompt pasted into a bare shell is executed.
