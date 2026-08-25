---
"@sma1lboy/rove": patch
---

Warn a new worktree task when its dependencies were never installed. If a lockfile is committed but its install output is missing (`node_modules`, `target`, `.venv`) and the repo configures no init script, the first prompt now ends with a note to run the install step before trusting build/test results. Advice only — installing stays `.rove/init.sh`'s job — and silent when an init script exists or the dependency directory is already there.
