---
"@sma1lboy/rove": patch
---

`rove --web` on a hub now shows the live state of tasks on other machines: the running and waiting marks, the change counts (`+18`, `↑140`) and the token chips, as that machine's daemon pushes them. Before, another machine's rows always looked idle with no changes. Their tab lists also refresh when that machine's activity changes.
