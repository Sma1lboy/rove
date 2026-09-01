---
"@sma1lboy/rove": patch
---

Stop a terminal-selection test from racing the snapshot refresh in CI.

`terminal-selection-trim` waited a fixed 80ms for the PTY backend to publish, but that backend coalesces refreshes on a 16ms timer, so a loaded CI runner could return before the state the test asserts on existed. It failed twice in one day with two different messages — `expected null not to be null` (no window published yet) and `expected 16 to be 10` (only part of the output folded in) — and blocked a release. The test now waits for the condition instead of a duration.
