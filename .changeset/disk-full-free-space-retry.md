---
"@sma1lboy/rove": patch
---

A full disk while creating a task's worktree or cloning a repo now says so ("The disk is full… Free some space, then try again") in place of git's raw error. The web composer keeps your draft and adds a Retry button, and the task that could not start is removed, so retrying does not leave a second row. `rove api add` gives the same advice in its hint.
