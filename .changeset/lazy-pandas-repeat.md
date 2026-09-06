---
"@sma1lboy/rove": patch
---

Five user-visible fixes around task creation and activity badges. A task
titled in a non-Latin script (Chinese, Japanese, emoji) now gets a branch
keyed on its task id instead of every such task colliding on `task`,
`task-2`, `task-3`. `add --branch` is checked against `git check-ref-format`
before anything is created, so an unusable name is an `INVALID_BRANCH` with a
hint rather than a raw git transcript at `ensure-worktree` and a backlog row
that can never materialize. A task title is flattened to one line wherever
titles are written, so a newline can no longer break a sidebar row's height.
An engine whose adapter emits no hooks (copilot) no longer wears a `dead`
badge forever after one death — fresh output in the tab now outranks it.
And `add` reports `repoResolvedFrom` when `--repo` pointed at a subdirectory
and resolved up to the repository root.
