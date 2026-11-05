---
"@sma1lboy/rove": patch
---

`rove --version`, `rove --help` and other quick commands start faster: the CLI no longer loads the daemon client and the full message catalog before it knows which command it is running. `rove --version` takes about 42 ms instead of about 55 ms.
