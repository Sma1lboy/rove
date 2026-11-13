---
"@sma1lboy/rove": patch
---

You can now update Rove on another machine without logging in to it. `rove machine update <alias>` (or with no alias, every machine) has that machine install the newest build of your channel and restart itself; on the web, a machine that runs an older build shows `[ update rove ]` in the Machines overview. Sessions on that machine keep running.

`rove daemon restart` on a machine where systemd runs Rove now restarts it through systemd. Before, it started a second copy outside systemd and the two fought over the same socket.
