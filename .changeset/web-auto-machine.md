---
"@sma1lboy/rove": patch
---

The web app's New session machine chip has an **Auto** row: Start sends the task to the least busy machine that has the project, and a toast names the machine it chose. The choice is remembered. Auto stays on this machine for a start only it can serve (attached files, a later start, several repos or engines), and so does `--machine auto` when the checkout's branch has commits no remote has, since another machine would start without them.
