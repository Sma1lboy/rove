---
"@sma1lboy/rove": patch
---

The task tree stops going quiet when you run many tasks across many repos

Three things in the sidebar only broke once the rail was full, which is when
you most need to read it.

Fanning out with `--count N` used to look like nothing was happening. Every
sibling starts life with the same placeholder name and no branch, and on a
large repo `git worktree add` runs for minutes — so five identical, motionless
rows was all you saw for the whole wait. The daemon was reporting progress the
entire time; only the row that could have shown it was a tab row that does not
exist until the worktree is ready. A worktree being created is now visible on
the worktree row itself, so a fan-out animates from the moment you launch it.

Two repos whose folders share a name — `~/work/api` and `~/oss/api` — drew two
headers both reading `api`, while a toast that had just named one of them said
`work/api`. Headers now include enough of the path to tell them apart, and only
when there is something to tell apart.

`/` search could not find a project's own main row by the branch printed on it,
because that name is read live from the checkout rather than stored. A
directory row had the mirror problem: it displays its path but was searchable
only by an auto-generated name it never shows. Search now matches what the row
actually displays, in both directions.
