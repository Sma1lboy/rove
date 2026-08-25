---
"@sma1lboy/rove": patch
---

Harden `api-cmd` tests to catch a regression in `--help` CLI name resolution. Add assertions that `verbHelp()` renders `rove api` when `ROVE_INVOKED_AS=rove` and falls back to `kobe api` when the marker is absent.
