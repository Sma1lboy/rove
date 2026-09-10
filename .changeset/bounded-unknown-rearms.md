---
"@sma1lboy/rove": patch
---

A tab whose engine transcript stops being readable no longer keeps its running badge forever. The watchdog that catches an engine which never reported finishing works by re-reading the engine's transcript: a recent write means the turn is still going, so it waits again. When it could not read the file at all it also waited again — which is right for a momentary read error and wrong for a transcript that is never coming back, because a deleted worktree or a replaced session answers "could not read" every single time and the badge waits out the life of the daemon. It now gives an unreadable transcript three full waits — half an hour at the default — and then stops believing it, handing the tab back to the observer that watches its terminal directly. Any single successful read resets the count, so a long turn on a healthy transcript keeps its badge exactly as before.
