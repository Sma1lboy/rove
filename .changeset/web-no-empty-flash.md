---
"@sma1lboy/rove": patch
---

Opening the web client no longer flashes "no open sessions in this task" before the task's tabs arrive: the empty state waits for the first tab list, which is now read right away instead of after a 300ms debounce.
