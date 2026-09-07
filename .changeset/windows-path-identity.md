---
"@sma1lboy/rove": patch
---

Use shared filesystem path comparisons across Windows session discovery, daemon home checks, task attribution, project pickers, saved repository settings, automations, and worktree actions. Native and Git path separators, drive-letter spelling, trailing separators, UNC paths, and long-path prefixes now identify the same location. Keep POSIX names and remote repository keys distinct, and preserve the current-worktree removal guard for directories named with a leading `..`.
