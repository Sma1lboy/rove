---
"@sma1lboy/rove": patch
---

Stop every successful task delete from raising a red error toast. Deleting a task tears down its engine sessions, and the PTY host recorded that requested kill in `pty-exits.json` exactly like a crash — the only thing separating the two was the exit status, and a killed child exits under `SIGKILL` either way. The daemon's exit watcher then replayed it as an engine death: a `dead` activity state, a durable Inbox episode, and an error toast titled with the raw task id, arriving a moment after the task itself was already gone. `PtyHost.kill()` now marks the session as closed on request and skips the death record, so a close you asked for is no longer reported as a death — this covers the sidebar delete, the Worktrees page delete, the headless task-deletion sweep, and closing a terminal tab. A crash still records and still toasts.
