---
"@sma1lboy/rove": patch
---

Routines: stop reporting success for firings that did not happen.

A sweep pass is serial, so a routine with a slow precheck stalls every routine
behind it — and the occurrences those routines missed left no record at all,
because the backwards cron search only ever returns the most recent one. A
per-minute routine could quietly become four-minutely and its history still
read as an unbroken column of `dispatched`. The gap is now counted and recorded
as a `skipped_missed` run naming how many occurrences never ran.

`dispatched` also meant "the login shell opened", not "the engine started" — so
a routine whose engine binary does not exist recorded `dispatched` forever while
every firing left a dead task behind, and `Run now` reported the same false
green. A firing now waits for the engine PROCESS to appear before reporting
success, and a failure records `dispatch_failed` carrying the session's own
`Engine exited (code N)` line.
