---
"@sma1lboy/rove": patch
---

Two engine tabs in one task no longer adopt the same session on restart. All tabs of a task share one worktree, and an engine that mints its own session id (kimi) is discovered by asking its store — which answers per-worktree. The restart pass ran every tab's discovery concurrently, so each computed the claimed-id set before any sibling had recorded one and all of them were handed the same newest session: two live engines writing one transcript. Discovery is now sequential and re-reads the claim set per tab, matching what the tab-naming poll already did.
