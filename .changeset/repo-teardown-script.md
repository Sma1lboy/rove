---
"@sma1lboy/rove": patch
---

- A repo can ship `.rove/teardown.sh`, which runs in a task's worktree just before Rove removes it, so the containers, databases or ports that `init.sh` set up for that task are cleaned up with it; a failing or slow script is logged and never blocks the removal.
