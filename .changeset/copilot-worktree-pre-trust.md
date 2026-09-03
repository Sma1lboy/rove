---
"@sma1lboy/rove": patch
---

Pre-trust a Rove worktree for Copilot, so a copilot task reaches its prompt
instead of a dialog nobody can answer.

Claude, Codex and Kimi each got a `trustWorktree` hook; Copilot never did, and
nothing recorded whether that was a decision or an omission. It was an
omission. Copilot CLI gates a first launch in a never-seen directory behind
"Confirm folder trust", and a Rove-created worktree is always such a directory,
so a hosted copilot session sat at the dialog. Worse than the other three: its
cursor sits on "1. Yes", which grants trust for that session only — so even a
human answering it is asked again on every relaunch.

Rove now writes the path into `trustedFolders` in Copilot's own
`<COPILOT_HOME>/config.json`, the same list its "remember this folder" answer
writes, merging into existing entries and preserving the JSONC header Copilot
puts at the top of that file. Verified against Copilot CLI v1.0.82: the dialog
appears in a fresh worktree, and after the pre-trust write the same worktree
launches straight to the prompt.

A registry-level test now fails if any builtin engine ships without a
`trustWorktree` hook, so the next engine added cannot omit it in silence.
