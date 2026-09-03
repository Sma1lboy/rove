---
"@sma1lboy/rove": patch
---

Repo init: record the outcome in the marker, and restore its exports for every
session. A `.rove/init.sh` that failed or timed out wrote no marker at all, so
the paste-delivery spawner (kimi) could not tell "init failed" from "init still
running" and sat out its whole 120s budget before delivering a task's first
message; the marker now carries init's exit code, and a recorded failure still
re-runs init on the next launch. The env restore has also moved outside the
once-per-worktree marker guard and into a durable `0600` dump next to the
marker, so a second engine tab — and a restart of the first — gets the PATH,
venv and API-key exports init set, instead of only the very first session in
the worktree ever seeing them.
