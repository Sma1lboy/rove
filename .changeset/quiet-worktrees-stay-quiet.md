---
"@sma1lboy/rove": patch
---

Idle worktrees stop being probed with `git` every two seconds. The daemon's
"which tasks have a working engine?" gate was reading the activity replay,
which carries known-idle tab entries on purpose — so every task that had ever
opened a terminal tab counted as busy and skipped the 60s quiet backoff for the
life of the daemon. The gate now reads the derived task rollup instead.
