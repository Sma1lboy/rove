---
"@sma1lboy/rove": patch
---

`rove api add --effort` sets a task's reasoning level on its FIRST session, and `set-effort` stops rewriting a wrapped preset's engine identity

Scripting a codex task at `xhigh` used to take three steps — `add`, `set-effort`, then a session rebuild — so the opening session always ran at the engine default. `add --effort` validates the level through the same gate `set-effort` uses and carries it into the create. Two `set-effort` fixes ride along: it now resolves a task's engine through the preset's declared protocol (so a level was not refused outright on every preset task created from the TUI), and it leaves the task's own vendor alone instead of overwriting a `mycodex` preset with `codex`, which silently dropped the user's `engineName.mycodex` label from the footer.
