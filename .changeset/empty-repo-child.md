---
"@sma1lboy/rove": patch
---

`rove api add` with a worktree in a repo that has no commits yet (a fresh `git init`) now fails with `REPO_HAS_NO_COMMITS` and a hint to make a first commit or pass `--no-worktree`, instead of a raw `git rev-parse HEAD` error under `RPC_ERROR`. Forking a task whose branch has no commits gets the same error.
