---
"@sma1lboy/rove": patch
---

Submit ordinary Codex prompts with its Tab key, which submits while idle and queues while working. On Windows, `rove api send` could paste text but miss the unchanged queue hint in ConPTY's incremental output, leaving the prompt in the composer until someone pressed Tab. Use the live target engine's submission capability for API sends and routines, without adding process probes. Keep terminal cursor updates inside synchronized frames so an unfinished cursor-only redraw cannot publish a cursor on the wrong row.
