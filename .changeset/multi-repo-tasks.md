---
"@sma1lboy/rove": patch
---

A task can span several repos: `rove api add --repo A --repo B` (first = primary, up to 8) cuts one worktree per repo on a shared branch, all or nothing. The engine runs in the primary and is told about the others (`--add-dir` for engines that support it, `ROVE_TASK_REPOS` / `ROVE_REPO_<NAME>`, one note on the first message). Delete checks every repo for uncommitted work first and removes them together. Land, sync and PR status still follow the primary only.
