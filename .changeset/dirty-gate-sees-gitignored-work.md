---
"@sma1lboy/rove": patch
---

Deleting a task no longer destroys gitignored work without asking.

The delete gate and the salvage snapshot both read `git status --porcelain`,
which is blind to `.gitignore`d files — so a worktree whose only work was a
`HANDOFF.md` or a `.scratch/` directory read as clean, deleted with no force
and no confirmation, and wrote no salvage ref. Both now also ask
`git status --ignored`, under the same 64 MB per-entry budget the snapshot
already used: the delete refuses for exactly what a `--force` retry then
rescues, and names the paths, because `git status` will not. A `node_modules/`
is over that budget and still deletes with no ceremony. This also covers a
nested worktree parked under a gitignored path, which was destroyed the same
silent way.

A salvage snapshot that could not capture everything now says so. `git add`
records a submodule or nested worktree as a commit pointer rather than its
files, so uncommitted work inside one was in neither the snapshot nor the
commit that pointer named — while the audit line still told you to
`git restore` from it. Those paths are now listed as `NOT captured`.

Deleting a task whose worktree directory was already gone now actually
deregisters it. The stale `.git/worktrees/` record can only be pruned from the
owning repo, and the prune was looking for that repo by walking up from
`~/.rove/worktrees/<key>` — a directory inside no repository — so it never
ran. The delete reported `removed` while `git worktree list` still showed the
entry as `prunable`, `git branch -D` failed forever with "used by worktree at
<gone path>", and the worktrees page kept offering the ghost for adoption. The
task's own repo is passed down now.
