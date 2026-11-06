---
"@sma1lboy/rove": patch
---

A routine precheck no longer reports a timeout when the daemon's login shell is bash (or `$SHELL` is unset on macOS): the finished command used to keep its output pipe open until the full timeout ran out, so a passing precheck was treated as a hung one and skipped.
