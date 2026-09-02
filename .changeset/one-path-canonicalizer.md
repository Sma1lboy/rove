---
"@sma1lboy/rove": patch
---

`rove api land` now refuses to remove the base checkout or the caller's own worktree using the same path canonicalizer that matched the worktree to its task. Previously the land-time guard resolved symlinks with a different primitive than the code that assigned the path, so the two could in principle disagree on macOS `/var` vs `/private/var` style paths. One `canonicalize` in `worktree/paths.ts` now backs every path-identity check in the orchestrator.
