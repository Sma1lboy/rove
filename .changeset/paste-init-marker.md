---
"@sma1lboy/rove": patch
---

Wait for repo-init marker before paste-delivery engine timeout (issue #73)

Paste-delivery engines (kimi) bracketed-paste the first message once the engine process appears, but the engine does not start until `.rove/init.sh` finishes. The 20s engine-startup budget was being consumed by `bun install`, so fresh worktrees silently dropped their first prompt. The spawner now waits for the init marker before starting that budget, and `add` surfaces a `NOT_DELIVERED` error when a prompt still fails to land (issue #72).
