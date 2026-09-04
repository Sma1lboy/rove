---
"@sma1lboy/rove": patch
---

Stop the attention surface reporting a failure as a fact.

- One `routine_failed` episode carrying a taskId — the shape the daemon
  actually writes when a firing builds a task and its engine never starts —
  no longer drops the WHOLE `attention.inbox` event. The Inbox read `0`
  permanently, survived daemon restarts, and could not be cleared from the UI
  because the queue rendered empty. A malformed row now costs its own row, and
  the three readers that disagreed about whether a routine episode may name a
  task now agree that it may.
- An unreadable `attention-inbox.json` (EACCES/EMFILE/EIO) no longer reads as
  an empty queue and then overwrites the file from that empty map, turning a
  transient blip into permanent loss. Malformed JSON still reads as empty.
- The kanban's "needs you" group knows `dead`. A task whose engine process was
  killed used to sit in In progress looking like ordinary work while every
  other surface already showed it as blocked.
- `pty-exits.json` is written with tmp+rename, and an unreadable read of it no
  longer empties the exit watcher's `seen` map — one bad read resurrected every
  death on disk, up to 50 duplicate `dead` badges and Inbox episodes carrying
  their original timestamps, which sorted them above whatever actually needed a
  person.
- A queued message now shows its deadline (`expires in 47m`), and expiring one
  leaves a dismissible `message expired — never delivered` row instead of
  silently deleting text whose sender was told the send succeeded.
