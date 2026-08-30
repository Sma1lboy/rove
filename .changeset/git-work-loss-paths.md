---
"@sma1lboy/rove": patch
---

Close three git paths that could destroy work.

`land --strategy squash --delete-branch` left the branch's original commits
reachable from nothing: the squash writes one unrelated commit onto the base,
the worktree removal takes the only reflog that recorded the branch tip, and
`git branch -D` takes the branch ref and its reflog. Rove now anchors the tip
at `refs/rove/salvage/<branch>-<stamp>` before deleting a branch nothing else
reaches, and returns it as `branchAnchor`. A `--no-ff` merge writes no anchor —
the merge commit already reaches those commits.

Removing a worktree from the Worktrees page, the web DELETE, or a land no
longer unlinks the directory while its engine is still running. `git worktree
remove` succeeds against a live process, so every write the engine made
afterwards went into an unlinked inode — gone from disk, from the branch, and
from the salvage snapshot taken before them. Both paths now tear the session
down first, matching what task deletion already did.

Salvage snapshots no longer drop gitignored work. `.gitignore` covers
`HANDOFF.md`, `.scratch/`, `.env` and `.rove/` in this repo alone, and a force
delete destroyed all of them while reporting success. Ignored entries up to
64 MB each are now included; larger ones (`node_modules/`, build output) stay
out.
