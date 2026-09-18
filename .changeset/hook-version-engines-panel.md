---
"@sma1lboy/rove": patch
---

Say which engines report to Rove, and whether what is installed is still the current shape

Rove learns what an engine is doing through three layers — the hooks it installs into the engine's own config, the completion markers it reads back from a transcript, and the screen rules it falls back to — and nothing on screen said which of them an engine actually uses. Settings → Engines now carries that on a third line under each engine, and one row installs the missing hooks for every engine at once. A missing layer is not a fault there: an engine whose hooks already report every state, including its permission prompt, needs no screen rules.

Installed hooks now carry the shape version that wrote them, so an entry left behind by an older Rove reads as outdated rather than as healthy. A settings file the merge is refusing now names itself on the engine's own row too — until now its only symptom was that every badge for that engine fell back to the daemon's ten-second poll.
