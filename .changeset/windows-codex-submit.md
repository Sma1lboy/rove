---
"@sma1lboy/rove": patch
---

Send Codex prompts with Enter, including while it is working, instead of switching to Tab when its queue hint appears. API sends and routines use the live target engine's submission behavior so messages can steer the current turn without waiting in the queue. Keep terminal cursor updates inside synchronized frames so an unfinished cursor-only redraw cannot publish a cursor on the wrong row.
