---
"@sma1lboy/rove": patch
---

Starting a task on another machine in a repo it has to clone first no longer loses the task. The clone used to freeze that machine's Rove until it finished, so a clone longer than a few seconds made the machine look offline; Rove then restarted it, which killed the clone and dropped the task.
