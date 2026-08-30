---
"@sma1lboy/rove": patch
---

Record an audit line for every task deletion, and stop dropping a task's tabs silently.

Task deletion previously logged only when the worktree removal FAILED, so a successful delete — the case that actually closes someone's tabs — left no trace, and no delete recorded who asked for it. `~/.rove/daemon.log` now carries a `task-deletion-audit` line per phase (`requested` / `removed` / `failed`) naming the task, its branch and worktree, the flags, and the caller's verified Rove session when `rove api delete` was run from inside one. A `failed` line also spells out that the session teardown and Inbox cleanup already ran while the worktree and task entry remain.

Separately, when a task's worktree disappears out-of-band (another client, the worktrees page, another agent), Rove drops every tab of that task. It now says so in a toast — how many tabs closed and that the branch survives — instead of doing it silently.
