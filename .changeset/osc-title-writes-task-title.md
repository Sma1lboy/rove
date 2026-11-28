---
"@sma1lboy/rove": patch
---

A session's name is now whatever named it last: your first message, then the engine's own terminal title each time it changes, `rove api update --title`, or a rename. The engine's title is saved on the session, so `rove api list` and every client show the same name, and a rename you make afterwards sticks until the engine picks a new title.
