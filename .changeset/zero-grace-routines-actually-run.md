---
"@sma1lboy/rove": patch
---

A routine with a zero missed-run grace now runs instead of skipping forever.

The sweep is a poller, so it can only ever see an occurrence after it happened
— `now - scheduledFor` lands somewhere in 0..60s on a perfectly healthy run.
The grace window was compared strictly against that gap, so
`missedRunGraceMinutes: 0` made every single firing "missed": the routine
recorded `skipped_missed`, advanced its schedule, and never dispatched, while
its run history filled with skips.

The window now has a floor of one tick — a grace of N means "up to N minutes
late, plus the tick that discovered it" — and a genuinely late occurrence is
still skipped. Negative values, which used to be accepted and then silently
rewritten to 60 on the next daemon restart, are refused at the RPC boundary,
as is a non-positive `precheck.timeoutSeconds`. `--grace 0` is now expressible
from the CLI, where it previously failed the positive-integer check.
