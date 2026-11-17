---
"@sma1lboy/rove": patch
---

- `rove api send --repo` reads its path like every other repo flag: a leading `~` expands, a relative path from the daemon or web bridge is refused instead of silently meaning the daemon's own directory, and a remote project's `ssh://` key reaches that project instead of turning into a bogus local path.
