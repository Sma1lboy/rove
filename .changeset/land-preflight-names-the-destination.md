---
"@sma1lboy/rove": patch
---

The land confirm now names what it is merging into. `docs/WORKTREES.md` tells you to check that the base checkout is on the branch you mean, and the one screen where that check belongs used to say "the base repo's current branch" — a description of a value Rove already held. It now reads `Merge "fix/auth" into main (3 commits), then remove this worktree?`, with the destination and the count read before the dialog opens.

The checks that refuse a land — detached base checkout, a base already on this branch, a dirty base, an unresolvable ref, a branch with nothing on it — used to run after you confirmed, so every refusal arrived as an error toast for a merge you thought was happening. They now run first and replace the dialog. Same words, before the decision instead of after it.

New `rove api land --dry-run` returns that read as JSON: `{ branch, landedOn, ahead?, baseDirty?, refusal?, message? }`, writing nothing. An agent picking which sibling of a round to land can now see `ahead: 0` — the empty merge — before it commits to one.
