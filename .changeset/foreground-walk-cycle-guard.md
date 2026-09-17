---
"@sma1lboy/rove": patch
---

Stop a racy process snapshot from freezing engine detection. The walk that identifies which engine is running inside a tab now skips process ids it has already visited, so a malformed `ps` reading whose parent/child links form a cycle can no longer spin forever — the same guard the ancestor check already applied. This protects the TUI foreground probe, the daemon activity observer, and `rove api inspect` from hanging on a stuck process table.
