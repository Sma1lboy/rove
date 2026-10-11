---
"@sma1lboy/rove": patch
---

`rove api read-output --tab tab-N` on an engine tab that has not received its first message now shows that tab's terminal, labeled `history_missing`, instead of an empty history page, so a fresh tab stuck on a trust prompt, login screen or early error is visible to whoever is reading it. `--source history` still returns the empty history page.
