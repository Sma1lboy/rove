---
"@sma1lboy/rove": patch
---

`--machine auto` now places work by each machine's real load. It used to count tasks in the Kanban "in progress" column, which stays empty unless `experimental.autoStatus` is on, so it almost always chose this machine. Each machine's daemon now reports its 1-minute load per core (with its system, cores and memory, under `load` in `rove daemon status`), and the work goes to the lowest one; this machine keeps it unless another is lower by more than 0.25. A machine on an older Rove, or on Windows, reports no load and is skipped.
