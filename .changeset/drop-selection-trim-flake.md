---
"@sma1lboy/rove": patch
---

Removed `test/tui/terminal-selection-trim.test.ts`: its one case raced real timers and failed on CI with the same `expected 0 >= 10` signature regardless of the change under test, blocking three releases in one day.
