---
"@sma1lboy/rove": patch
---

`rove --web` now writes each destructive action from the web app or a phone (delete or land a task, close a tab, remove a worktree, delete a routine) with the time, the device that sent it and its address, so "who deleted my task" has an answer. A bridge started with `--device <name>` no longer serves that device's token as the shared one: the device is now named in the log, and the shared link keeps working.
