---
"@sma1lboy/rove": patch
---

The installed Rove agent skill now picks up the `worktree-usage --merged` and `--idle-days` flags. The flag reference had changed without a new skill version, so `rove skill status` kept reporting an older copy as current.
