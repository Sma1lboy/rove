---
"@sma1lboy/rove": patch
---

`rove api add --machine any|auto` hands a new task to a fleet center, which places it on a worker: the least loaded one for `any`, the one the prompt fits for `auto` (by each machine's `fleet.tags` and `fleet.description`, or a `fleet.router` endpoint). Workers are matched to the repo by its `origin` URL, so the task is created at that worker's own checkout, and a worker at its `engine.maxLiveSessions` cap is skipped. `fleet.centers` lists the machines that may schedule, tried in order, so the next one takes over when the first is down. New `node-status` and `fleet-status` verbs show each machine's load and which center your calls go to.
