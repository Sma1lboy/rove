---
"@sma1lboy/rove": patch
---

Deleting a task on Windows now ends its engine. The teardown ran `taskkill /T` on the tab's Git Bash shell and every line came back SUCCESS, but Claude Code kept running in the deleted worktree, and it could still send messages to the task that dispatched it. `taskkill /T` follows Windows parent pids, and Git Bash breaks that chain on every `exec`: the program it starts (the `claude` npm shim, then the engine it execs) runs as a new Windows process whose parent is a forked shell that has already exited. The PTY host now reads Git's own process table, which keeps the real parentage, before it kills anything, and ends every process under the shell in the same `taskkill`. The same survivors held the worktree as their working directory, which is why a deleted task's directory so often stayed on disk with `Permission denied`.
