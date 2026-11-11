---
"@sma1lboy/rove": patch
---

A Copilot task starts again. Copilot CLI 1.0 refuses a bare prompt on its command line (`error: Invalid command format`), so every Copilot session that carried a first message, a task prompt or a repo init-prompt, exited with code 1 before the engine came up. Rove now hands Copilot its first message behind `-i`, the flag the CLI asks for; no other engine's launch line changes.
