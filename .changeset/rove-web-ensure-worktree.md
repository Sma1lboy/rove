---
"@sma1lboy/rove": patch
---

In `rove --web`, a task created from an existing repo without a first message now gets its worktree when it opens, as in the TUI. Before, the page selected it with no worktree, so its Files pane said "no worktree yet". Task rows sent to phones and the browser carry a new optional `noWorktree` flag; older apps ignore it.
