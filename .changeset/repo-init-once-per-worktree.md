---
"@sma1lboy/rove": patch
---

`.rove/init.sh` now really does run once per worktree. Its marker is a receipt, deleted for the whole run and keyed by worktree — which every tab of a task shares — so two tabs opening before the first init finished, or any worktree whose last init exited non-zero, both passed the gate and both ran the script. Two installs in one directory, and the shared env dump they raced over could reach the engine truncated or missing, leaving it without the PATH, venv, or API keys init exported. A `set -C` lock now admits one run; the other waits for its marker and sources a complete dump.
