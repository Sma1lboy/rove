---
"@sma1lboy/rove": patch
---

Prompts Rove injects follow the language you write in

Text Rove sends into a session on its own — the missing-dependencies warning
on a fresh worktree, and the continuation typed in after a rate limit clears —
was always English, so a session you were running entirely in Chinese kept
getting pulled back to English.

Rove now notices which language your first prompt is written in and keeps
using it. Nothing to configure and no setting to find: if you write Chinese,
the text Rove adds comes back in Chinese.

The quota-resume case is the one that needs this most — it fires from a timer
long after you last typed anything, so there is no message in hand to take the
language from.
