---
"@sma1lboy/rove": patch
---

Let the sidebar close a background task's last tab, the same as ctrl+w does on the task you are looking at.

Closing a task's last tab has been allowed since the row started surviving it — but only on the mounted path. The tree's close action routes through a second function for every task whose workspace is not on screen, and that one still refused, so with several tasks open the same click worked on the focused task and failed on the others with "cannot close the only tab". Which task happens to be mounted is invisible from the tree.

The refusal toast now names the one case that remains false — a tab the tree lists but the state no longer has.
