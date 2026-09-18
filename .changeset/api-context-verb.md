---
"@sma1lboy/rove": patch
---

`rove api context --repo PATH` — the coordinator's start-of-turn read: one composed snapshot of a project with every worktree task's derived group (waiting-on-you / landing / ready-for-review / working / idle / unknown), sorted so the first row is what needs a person next, plus the unhandled attention inbox and the repo's newest field notes. `--text` renders it compactly for an agent to read. `attention.list` is a new daemon RPC so a headless coordinator can see the inbox at all.
