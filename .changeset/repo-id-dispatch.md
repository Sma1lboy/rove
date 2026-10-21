---
"@sma1lboy/rove": patch
---

`rove api add --repo` takes a repo id as well as a path: `owner/name` for GitHub, `host/owner/name`, or a remote URL. It resolves to the checkout on the machine that runs the task, so `rove api add --machine narwhal --repo sma1lboy/rove` works without knowing where narwhal keeps it. When a machine has several checkouts, the one you mark with `rove machine primary <path>` wins, else a clean one. A checkout that is only a fork (same history, another origin) is refused with `FORK_MATCH` unless you pass `--allow-fork`. With `--clone`, a machine that has no checkout clones the repo into `~/.rove/repos/<host>/<owner>/<name>` first; without it you get `NO_LOCAL_CHECKOUT` or `NO_REMOTE_CHECKOUT` naming the fix. `--machine auto` now only places work on machines that have the repo, falling back to the least-busy machine when none does. `rove api repo-list` lists a machine's repos by id with their checkouts and primary, and `repo-match` gains `--allow-fork`.
