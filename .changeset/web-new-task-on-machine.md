---
"@sma1lboy/rove": patch
---

`rove --web` can create a task on another registered machine. The New Task dialog gains a Machine row (this machine plus each registered machine). Pick one and the repo field takes a path on that machine, suggesting the projects it already has, with an optional base branch; the task is created in that machine's daemon and opens in the rail. Pressing `n` on another machine's row opens the dialog on that machine with that row's repo. Also fixed: in recent Chromium a project or branch picker could blank the whole page when its list refreshed, because `scrollIntoView` now returns a Promise that an effect handed back to React as its cleanup.
