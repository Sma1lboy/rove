---
"@sma1lboy/rove": patch
---

The Rove agent skill no longer tells agents that every project keeps a long-lived main task to send cross-project requests to. That was one workspace's habit, not something Rove sets up, and agents following it started conversations on a project's main row, which then showed every pull request ever attached there.
