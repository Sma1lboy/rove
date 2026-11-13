---
"@sma1lboy/rove": patch
---

A session opened with `rove api send --tab new` now remembers who opened it, so its plain `rove api send` report goes back to that session instead of whichever task happens to be selected. A session nobody dispatched is now told `NO_REPLY_ADDRESS` when it sends without `--task-id`, rather than starting an agent in an unrelated task.
