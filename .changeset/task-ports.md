---
"@sma1lboy/rove": patch
---

`rove api ports --task-id <id>` lists the ports a task's processes listen on, with a ready `url`, so an agent finds the dev server it started without scanning by hand; `--all` tags every listener on the machine with its owning task.
