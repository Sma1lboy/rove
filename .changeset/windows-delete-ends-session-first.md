---
"@sma1lboy/rove": patch
---

Deleting a task on Windows no longer leaves an empty `~/.rove/worktrees/<repo>/<name>` directory behind with `Permission denied`.

The cause was ordering. The daemon's deletion runner removed the worktree in the background while the client killed the task's engine session after the delete RPC had returned, so the two raced — and a process whose working directory is inside the worktree makes that directory undeletable on Windows, so git deregistered the worktree and the directory stayed. On top of that, ending a session only terminated the shell: ConPTY has no process groups, so the engine and everything it had spawned kept running inside the directory.

A deletion now ends the task's session first and waits for it to exit before `git worktree remove` runs. On Windows that end is `taskkill /T /F` on the shell's whole process tree, and only then is the pseudo console released. `pty.kill` accepts `wait: true` for callers that need the exit rather than the acknowledgement; an older PTY host ignores the flag and answers as before. The audit line for a directory git could not delete is unchanged — it now names something outside Rove.
