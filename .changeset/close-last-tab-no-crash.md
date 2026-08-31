---
"@sma1lboy/rove": patch
---

Fix the workspace crashing after you close a task's last tab

The center column decides whether to mount the terminal pane by reading a
module-level map of each task's tabs — a plain `Map`, which React does not
watch. Closing the last tab wrote the now-empty list there and re-rendered
nothing, so the pane stayed mounted over a tab list it is built to always
find an active tab in, and the workspace crashed to the pane-crash placeholder
instead of showing "No sessions here".

Writes to that map now go through `setTaskTabs` / `deleteTaskTabs`, which bump
a subscribable revision the center column reads. The one write left untouched
is the mount-time lazy init, which runs during render and must stay silent.
