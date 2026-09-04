---
"@sma1lboy/rove": patch
---

Fix four ways the non-Claude engines misreported themselves, and refresh five stale vendor facts.

OpenCode's positional argument is a project directory, so `rove add --engine opencode --prompt …` was handing it the prompt as a path and the engine died before it started — it now takes its first message by paste, the way Kimi already does. OpenCode 0.6.3 also prints `esc interrupt` rather than the `esc to interrupt` its activity rules looked for, so an OpenCode task never showed running; it now reads working while a turn runs and idle at rest. A Cursor task sitting on the login wall classified exactly like a healthy resting one — it now reads as blocked on you, so a task that cannot run at all stops looking fine.

Codex's effort picker gains `max`. Kimi's selection-dialog rules learn 0.40.1's `↑↓ navigate · Enter select · Esc exit` footer while keeping 0.37.2's, and its worktree pre-trust now hashes the resolved path and lowercases the directory name the way Kimi itself does — a worktree reached through a symlink was getting a trust record Kimi never looked at, so the dialog still blocked the launch.
