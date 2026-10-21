---
"@sma1lboy/rove": patch
---

Tasks start on a Linux box that has no `$SHELL` and no zsh, such as a container, a systemd unit or cron. Rove fell back to `/bin/zsh` there, every task's terminal failed to spawn with `ENOENT`, and the tab stayed empty with nothing on screen. Without `$SHELL`, Rove now uses the first of its usual fallback, `/bin/bash` and `/bin/sh` that is installed. An explicit `$SHELL` is used as before.
