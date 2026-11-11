---
"@sma1lboy/rove": patch
---

- A new task the web composer starts on a Windows machine runs its agent on that machine again, as the docs promise, instead of trying to keep the agent here and failing to reach the Windows worktree; `rove api add --workspace-on <alias>` now refuses a Windows machine up front with `UNSUPPORTED` and points at `--engine-there`, before that machine cuts a worktree it would only take back down.
