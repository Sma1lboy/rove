---
"@sma1lboy/rove": patch
---

`rove api add --repo <folder>` now starts a session in a folder that is not a git repository instead of refusing it. The session runs in the folder itself, with no worktree and no branch. This is what New session on the web uses for a folder on another machine, so + on such a project there can now start. Whether the folder is a repository is checked at each start: after `git init`, new tasks in it get worktrees. Flags that need a repository (`--branch`, `--worktree-only`, `--count` and the like) are still refused there with NOT_A_REPO.
