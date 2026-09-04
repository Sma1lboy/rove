---
"@sma1lboy/rove": patch
---

The force-delete confirm stops overstating the danger.

Both force-delete confirms said uncommitted work would be `PERMANENTLY LOST`.
It is not: every force path snapshots the worktree to `refs/rove/salvage/…`
before `git worktree remove --force` runs. Warning about a loss the product is
about to prevent pushes people to cancel a safe operation, and teaches them to
discount the warnings that are real.

Both sites now share one wording that names the snapshot and the command that
lists it (`git for-each-ref refs/rove/salvage`) — one event described once,
instead of two wordings for the same thing, one of them shouting.
