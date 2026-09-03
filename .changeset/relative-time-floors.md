---
"@sma1lboy/rove": patch
---

One relative-time clock, and it floors. The Routines page rounded while every other surface floored, so the same instant read two ways: a routine firing in 1h40m previewed as `in 2h` and fired twenty minutes early, and a run 100 seconds old showed `2m ago` on the Routines page while the Inbox called it `1m`. `relativeBuckets` in `lib/relative-time.ts` now floors and owns the label too — `relativeAgeMs` is gone from `tui/history/message-core.ts` and its six consumers read `relativeAge` from the one module. A sub-minute run also now reads `now` / `just now` instead of `1m ago`.
