---
"@sma1lboy/rove": patch
---

Test-only: the task-index store edge suite waits for the async client log write before removing its temp home, fixing an intermittent ENOTEMPTY teardown failure on CI.
