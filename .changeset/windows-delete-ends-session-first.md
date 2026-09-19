---
"@sma1lboy/rove": patch
---

Deleting a task on Windows no longer leaves an empty `~/.rove/worktrees/<repo>/<name>` directory behind with `Permission denied`.

A deletion already ended the task's session before it ran `git worktree remove`, but "ended" meant "asked": `pty.kill` answered as soon as the request was taken, so the removal ran while the child was still exiting — and a process whose working directory is inside the worktree makes that directory undeletable on Windows, so git deregistered the worktree and the directory stayed. On top of that, ending a session on Windows only terminated the shell: ConPTY has no process groups, so the engine and everything it had spawned kept running inside the directory.

The session teardown that precedes a worktree removal (task delete, Worktrees-page delete, land) now waits for the child to exit — `pty.kill` accepts `wait: true` and holds the reply until then, bounded by the host's existing grace; an older PTY host ignores the flag and answers as before. On Windows the teardown is `taskkill /T /F` on the shell's whole process tree, and only then is the pseudo console released. The audit line for a directory git could not delete is unchanged — it now names something outside Rove.
