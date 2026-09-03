---
"@sma1lboy/rove": patch
---

Daemon collectors share one poll scheduler and one ticker. `maybeStartScheduledRun` lived three times (once in the CLI package, twice byte-identical in the daemon) because the daemon cannot import the CLI; it now lives in the daemon and the CLI re-exports it. Eight daemon loops that each hand-rolled the same `setInterval` skeleton (tick guard, reentrancy flag, subscriber gate, unref, clear) share `startTicker`, with the three real per-collector variations kept as explicit options. Behavior add: the quota-usage cache gains the `tickMs <= 0` disable guard every sibling already had.
