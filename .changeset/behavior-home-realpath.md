---
"@sma1lboy/rove": patch
---

Resolve the behavior suite's temporary HOME so its path assertions hold on macOS.

`tmpdir()` there is the `/var` symlink to `/private/var`. Rove reports the real path, so every test comparing a path it built against one Rove printed differed by that prefix and failed locally while passing on Linux CI.
