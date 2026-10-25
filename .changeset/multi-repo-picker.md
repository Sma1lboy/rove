---
"@sma1lboy/rove": patch
---

Pick several repos when starting a task. The web composer's project chip is now a check-list (the list stays open, the first pick is the primary, the chip reads `web +2`) and its branch chip becomes a Branches menu with one shared branch name and a base ref per repo; the TUI new-task dialog gains an "also include" list of the other saved repos. Both rails mark a multi-repo task with `+N`. `add --base-for` now matches a path by git root, so a symlinked spelling of a repo no longer fails. A composer start remembers its engine as the project's last, so New conversation follows it, and `send --tab new` serializes per task however the task was found (`--task-id`, dispatcher, or active task).
