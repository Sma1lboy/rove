---
"@sma1lboy/rove": patch
---

Deleting a KV key (`set(key, undefined)`) now removes it from the in-memory snapshot instead of leaving it enumerable. A stale `terminalTabs.*` snapshot left the orphan sweep re-"deleting" the same key on every task-list change — each pass a new snapshot identity, which re-armed the sweep effect into an infinite setState loop and crashed the workspace with React #185.
