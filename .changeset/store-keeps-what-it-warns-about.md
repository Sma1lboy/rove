---
"@sma1lboy/rove": patch
---

The issue store keeps the story it warns you about, and the Kanban board stops
losing a backlog when the task that made it ends

`skipped` used to document a recovery window one mutation wide. A read that met
an entry whose `id` was not a number dropped it, counted it honestly, and logged
the repo — then the next write re-emitted only what it had parsed, so one
unrelated `issue-set-status` on a different story erased the unreadable one from
disk. Reads still skip; writes now carry those raw entries through untouched, so
the warning describes something you can still go and fix.

The same read met a record whose `issues` was an object and reported `skipped:
0` — the one value the field documents as "you have it all" — after dropping
every story in it. It now counts them, and a write aimed at that repo refuses
with `ISSUE_STORE_UNREADABLE`, naming the file and the repo, instead of
persisting the emptiness on the next `issue-create`. A write to a sibling repo
in the same file round-trips the unreadable record whole. A syntactically broken
store keeps failing loudly and leaving the file byte-for-byte intact; its error
now names the path.

The Kanban board derived its project sections from live tasks, so the ordinary
end of the loop — land the work, delete the task — took the whole backlog off
screen and left the page saying "No projects yet — create a task first", with
the stories still on disk. A story filed with `issue-create --repo <path>` into
a repo that never had a task was invisible from the moment it was filed. Sections
now come from every repo that can have a backlog: the ones the issue store holds
a record for (a new `issue.repos` read), your saved projects, and the repos of
live tasks. The empty-state line now says how to get a project instead of naming
tasks as the only route.

An issue whose own status is `doing` lands in In progress. The board bucketed it
with `open`, so the documented `open → doing → done` step moved no card, and the
story drawer's "project" placement — which writes exactly that status and links
no task — left the card in Backlog while its engine ran. The link is still the
other way in, and is still what `--task none` reverses.
