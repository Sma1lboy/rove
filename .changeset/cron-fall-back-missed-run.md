---
"@sma1lboy/rove": patch
---

- A routine whose run fell in the hour that repeats when daylight saving ends no longer loses that run if the daemon catches up during the hour's second pass; before, it logged a false missed run every minute until the clock caught up and never ran the real one.
