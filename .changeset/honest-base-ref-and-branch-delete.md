---
"@sma1lboy/rove": patch
---

`collect`'s ahead-count is measured against a base the task actually came from.

The base was resolved by walking `origin/HEAD` → `origin/main` → `origin/master`
→ `main` → `master` and taking the first ref that resolved, without asking
whether that ref had anything to do with the branch. A repo with an abandoned
orphan `main` beside a live `develop` reported `ahead: 5, behind: 1, diff: null`
for a task holding one commit — and `ahead` is the number a fan-out coordinator
picks winners on, where five looks like an attempt that did more work. The null
diffstat was the only tell, and it is the field nobody reads. Each candidate is
now checked for a common ancestor before it is accepted, and when none of them
has one the base falls back to the branch the base checkout is actually on —
what `land` has always merged into. A remote-less repo whose default branch is
`trunk` reported every field null and now reports `trunk`, matching what
`land --dry-run` answered on the same task all along.

A base checkout with no commits yet is no longer reported as detached. `git
rev-parse --abbrev-ref HEAD` exits 128 there and prints the literal string
`HEAD` on stdout; the exit code was never read, so a repo sitting squarely on
`main` was told to "check out a branch first" — advice the user was already
following. `land` now asks `git symbolic-ref`, which names the branch of an
unborn HEAD, and refuses with `UNBORN_BASE` naming the real condition. Reading
the exit code also splits "git could not read this repo at all"
(`UNREADABLE_BASE`) out of the detached answer it used to share. A genuinely
detached base checkout still refuses with `DETACHED_HEAD`.

`delete --delete-branch` on a task whose worktree directory was already gone
kept the branch. The branch to delete was read out of the worktree, which by
then did not exist, so the delete reported `removed` with the branch still in
`git branch` — the same shape as the stale admin record fixed alongside it,
where a verb reports success while doing nothing. The task's own branch is now
passed down for that case.

"Sync with base" no longer offers `git stash` as a way to clear a dirty
worktree. It was the last recommendation of it left in the product, and the
worktree it was talking about is a managed task worktree: the stash stack lives
in the repo's common dir and is shared by every linked worktree, so a parallel
task can pop or drop what was stashed there. It says commit, like every other
surface already did.

Internal: the two copies of the `git status --porcelain` path parser — landing's
and syncing's, the second asserting it was the same shape as the first while
being strictly more careful — are one function. — [@Sma1lboy](https://github.com/Sma1lboy)
