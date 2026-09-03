---
"@sma1lboy/rove": patch
---

Stop misreporting git failures during a land or a sync. A `git commit` that
failed for any reason Rove has no policy for — a pre-commit hook, a broken
`commit.gpgsign` key, an unset `user.email` — used to come back as "'branch' has
nothing to land onto 'main' (already merged or empty)" on a squash (which then
`reset --hard` threw the staged merge away) or as a conflict with an empty file
list on a merge. Both now surface git's own message; the squashed merge is left
staged so it can be committed by hand once the cause is fixed.

Syncing a worktree with its base likewise refuses up front when an untracked
file would collide with one the base adds — the guard was passing
`--untracked-files=no`, so that case slipped through to an unmappable "git merge
failed". The dirty refusal now names the offending files, and the residual
failure branch quotes git instead of only saying that it failed.
