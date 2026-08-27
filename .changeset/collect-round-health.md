---
"@sma1lboy/rove": patch
---

`rove api collect` answers "what is this parallel round's status right now" in one read. Select a whole fan-out round with `--group <groupId>` (spanning repos, skipping archived siblings) alongside the existing `--repo` and `--task-ids`. Each task now also reports `.activity` — the engine's state and how long it has held it, from the daemon's activity registry, or `null` when the registry genuinely cannot answer rather than a fabricated idle — and a dead tab's `.exit` now carries the session's output `tail` next to its exit code, so a crashed worker comes back with its cause attached.
