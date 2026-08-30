---
"@sma1lboy/rove": patch
---

Remove the dead Archive chain from the web dashboard and the daemon (issue [#75](https://github.com/Sma1lboy/rove/issues/75) slice C).

The web UI still offered Archive/Restore long after the concept was removed. Clicking Archive called a daemon handler that ignored its input and returned a constant, and the confirmation dialog promised the task "can be restored from the Archived section" — a section that could never fill, because nothing in the codebase ever set `archived`.

- The Archive button, Restore button, archived banner, Archived sidebar section, and the archived-history preview drawer are gone from the web dashboard, along with the "Archived history preview" settings toggle (the daemon stopped persisting that key in 0.9.6).
- The `task.archive` and `worktree.archiveRemoved` daemon handlers, their protocol names, and the `archived` field on the wire and task types are removed.
- `rove hook worktree-created` no longer reports `git worktree remove` to the daemon; an already-installed hook stays harmless and exits 0.
- Removes the retired `KOBE_NO_DAEMON` key from `rove doctor`'s environment report.
