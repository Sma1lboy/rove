---
"@sma1lboy/rove": patch
---

Selecting text in the web terminal no longer copies it. Copy with Ctrl+Shift+C or Cmd+C (Ctrl+C still copies a selection). This also holds for an engine that draws its own selection and copies when the mouse lets go, as Claude Code does: its text waits for the copy key instead of landing on the clipboard.
