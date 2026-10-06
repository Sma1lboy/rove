---
"@sma1lboy/rove": patch
---

New task worktrees on macOS start with the main checkout's `node_modules`, `.venv`, `target` and `.build`, cloned copy-on-write on the same APFS volume before `.rove/init.sh` runs. Turn it off with `worktree.cloneIgnored: false`, or set a per-repo list in `.rove/clone-dirs`.
