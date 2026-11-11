---
"@sma1lboy/rove": patch
---

A task started with `add --workspace-on <machine>` now shows that machine's files and diff in the Files pane (web and terminal), and a new shell tab in it opens a shell in the worktree there. Before, both looked at the empty link directory on this machine. `rove api worktree-files`, `worktree-diff`, `worktree-diff-file`, `worktree-file` and `worktree-refs` read the worktree there for such a task.
