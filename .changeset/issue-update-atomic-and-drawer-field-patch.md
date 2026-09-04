---
"@sma1lboy/rove": patch
---

`rove api issue-update` no longer half-applies. Title, body and the task link
used to travel as two separate `issue.mutate` calls, so `--title X --task
<bogus>` renamed the story and then failed the link — exit 1, a typed
`TASK_NOT_FOUND`, and a hint telling you to retry a command that had already
committed half its work. All three fields now ride one store write, and the
task-existence check runs before the store takes its lock, so the error means
what it says: nothing landed.

The Kanban story drawer no longer reverts a field it never saw. It sent both
the title and the body on every save, compared against the snapshot it opened
with — so a person fixing a typo in the title silently overwrote a description
an agent had rewritten while the drawer sat open. The save now carries only the
fields that were actually edited.
