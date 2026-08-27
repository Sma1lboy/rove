---
"@sma1lboy/rove": patch
---

Every "the launch command already sets this flag" guard now recognizes the attached `--flag=value` form through one exported `argvHasFlag` helper — the engine-command parser deliberately keeps `claude --resume=<id>` or `--append-system-prompt="…"` as a single token, and the exact-token guards missed it, so kobe appended a second `--session-id` (claude refuses to launch) or double-injected its worktree/dispatcher prompt over the user's own. Forking a chat on a base command that already pins its own session now declines instead of composing two `--resume`s, and an architecture test rejects any future exact-token `argv.includes("--…")` guard so the class can't recur.
