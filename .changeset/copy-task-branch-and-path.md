---
"@sma1lboy/rove": patch
---

A task row's right-click menu now offers **Copy branch name** and **Copy path**, so a `git checkout` or `cd` into a task's worktree from another shell no longer means retyping a truncated sidebar label or shelling out to `rove api get-task`. Both write through the same two channels the terminal's copy-on-select already uses (the local clipboard command plus OSC 52, which is what reaches your machine over SSH) and confirm with a toast naming what was copied. Copy path copies the recorded worktree path without creating the worktree, and a project-main or directory row, whose stored branch is empty, offers only Copy path.
