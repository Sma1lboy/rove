---
"@sma1lboy/rove": patch
---

Sidebar task rows carry `↑N` — commits the worktree has that its base does not.
Committing empties `+N` / `−N`, so a worker that shipped its work and one that
reported success and shipped nothing rendered the identical blank row; you found
out which at land time, as `EMPTY_BRANCH`. The collector now measures both
directions in one `git rev-list --left-right --count <base>...HEAD` — the same
process that already produced `↓N`, so this costs no extra fork per poll and the
two numbers can never straddle a commit. `↑N` leads the chip group in the success
tone, and like `↓N` it is absent rather than zero when no base ref resolves.
