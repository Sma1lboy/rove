---
"@sma1lboy/rove": patch
---

Added IBM Bob (`bob`) as a built-in engine, so it appears in the engine selector whenever `bob` is on your PATH and can be fanned out like any other engine: `rove api add --agents bob:3 --prompt "…"`.

Two things had to be right for a parallel round to work. Rove launches it as `bob chat --trust`, because `bob` alone only prints help and a fresh worktree otherwise stops the TUI on "Do you trust this folder?" — a round of nine would open nine dialogs with nobody to answer them. And the first message is pasted rather than appended to the command line: `bob chat` declares no positional argument and Bob discards a stray one without an error, which would have left every sibling of a round sitting at an empty composer.

Bob is built in for its history and account reads. Rove reads its SQLite store for the conversation, per-session token and context counts, and the sessions belonging to a worktree; Settings → Engines reports whether you are signed in, not who, because Bob keeps only an opaque token and Rove does not decode credential material. Workspace trust is pre-written the way it already is for Claude, Codex, Kimi and Copilot.

Activity badges come from a screen manifest captured against Bob Shell 2.0.4 and re-verified word-for-word on 2.0.5: the command-approval dialog, the folder gate and the browser sign-in wall all read as blocked, a streaming turn reads as working, and the resting composer as idle. The sign-in wall matters because an expired token leaves Bob on a bare spinner — without a rule for it a task that cannot run keeps whatever badge it had, and looks like it is resting.

Hooks are the one thing Bob does not get: its bundle carries Claude's nested hook schema, but nothing fires from either the workspace or the global settings document on 2.0.5, so session identity comes from the history store keyed by worktree instead — the same origin Kimi uses.
