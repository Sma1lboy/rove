---
"@sma1lboy/rove": patch
---

Auto-fix CI, opt-in per task (`rove api update --auto-fix-ci on`, or the toggle in the web Files pane's checks section). When the task's PR checks go red on a new commit and the agent is idle, the daemon sends it the failing logs: once per commit, three times in all, then it stops and raises an Inbox row. The checks section shows `auto-fix 1/3`.
