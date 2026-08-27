---
"@sma1lboy/rove": patch
---

Three TROUBLESHOOTING entries for failures that gave the user no signal at
all, each named by the symptom rather than the mechanism:

- **A plugin installs cleanly, but Rove never loads it** — `rove plugin list`
  reads the registry file, the daemon is what loads plugins, and before
  0.8.198 a write racing daemon startup fell into the macOS FSEvents arming
  window and was dropped until the next restart.
- **`rove api set-branch` fails, but the branch was renamed anyway** — the
  pre-0.8.198 error quotes git's `no branch named …` against the main
  checkout while the worktree already holds the new name, so the caller
  cannot tell partial success from failure. Says what to read instead of
  retrying, and why renaming by hand makes it worse.
- **One task's badge never moves, and its title never auto-fills** — the
  single-worktree counterpart to the existing all-tasks hooks entry: before
  0.8.198 Rove's Claude project-dir encoding folded only `/` and `.`, so any
  path with an underscore, space, or non-ASCII character pointed at a
  directory Claude never wrote.
