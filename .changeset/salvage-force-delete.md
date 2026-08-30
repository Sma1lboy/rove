---
"@sma1lboy/rove": patch
---

Force-deleting a worktree no longer loses your work for good

Deleting a task with `--force` runs `git worktree remove --force`, which wipes
uncommitted edits and any file you had not yet `git add`ed. There was no copy
anywhere, so the only thing standing between you and a lost afternoon was the
confirmation dialog — and two of the three force-delete paths never showed one.

Rove now snapshots everything a forced removal is about to destroy into a git
ref in the owning repo, before removing anything. List them with
`git for-each-ref refs/rove/salvage`, then recover a file with
`git restore --source=refs/rove/salvage/<branch>-<timestamp> -- path/to/file`.
Files your `.gitignore` covers stay out, so a snapshot is your work, not your
`node_modules`.

The ref is also written to `~/.rove/daemon.log` next to the deletion's existing
audit lines, with the recovery commands already filled in — the log you search
by task title and time when you notice something is missing.

Closing a scratch shell no longer passes `force` at all. It never needed to (a
scratch row owns no worktree), and the flag stood ready to authorize a real
destructive removal if that ever stopped being true.
