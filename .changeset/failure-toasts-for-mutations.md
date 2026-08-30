---
"@sma1lboy/rove": patch
---

Surface failed mutations as error toasts instead of invisible logs or muted hint lines

Three pages told the user nothing (or something easy to miss) when a mutation failed:

- Kanban: a failed issue create/delete logged to the daemon log only — under the alternate screen a bare `console.error` is invisible, so the card just stayed on the board.
- Routines: create/delete/toggle/run-now failures rendered as a gray muted line, reading like a hint rather than a failure.
- GitHub issues: a failed "start work" did the same.

All three now send failures through the shared toast queue as `error` toasts (red accent, always shown even with toasts disabled), keeping the daemon-log line for forensics and leaving the muted inline line for non-failure status only.
