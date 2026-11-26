---
"@sma1lboy/rove": patch
---

A new session on another machine has a Worktree toggle too. Off, the agent still runs on this machine and works in that machine's checkout itself, on its current branch, so there is no Branch to pick; `add --machine X --no-worktree --repo <path there>` does the same from the CLI. Deleting such a task leaves the checkout as it is. A Windows checkout path also names its link directory after the folder now, not the whole path.
