---
"@sma1lboy/rove": patch
---

A diff review note added on the web or in another Rove window is no longer lost when you add, remove or send notes in the terminal. The terminal used to save its own copy of the task's notes over the newer list, and sending marked a note written elsewhere in the meantime as sent although the agent never received it.

Failed note writes retain pending edits for retry against fresh disk state, including removals and sent markers, instead of losing a typed note.
