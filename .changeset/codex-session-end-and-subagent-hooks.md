---
"@sma1lboy/rove": patch
---

Codex now delivers session-end and subagent hook events, and ENGINES.md stops crediting Codex with hooks it never had

`SessionEnd`, `SubagentStart` and `SubagentStop` are in codex-cli's hook event enum but were never installed, so a cleanly-quit Codex task kept whatever state its last hook set and a Codex row never showed the `◇N` subagent marker. The adapter's own comments disagreed with each other about whether those events existed; they now say what the binary says. `docs/ENGINES.md` no longer claims Codex reports the full needs-input vocabulary through hooks (its only waiting event is a permission decision hook Rove deliberately leaves alone), and now documents Codex's quota probe alongside Claude's.
