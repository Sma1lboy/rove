---
"@sma1lboy/rove": patch
---

Internal: two terminal render tests wait for the pane to attach to its PTY before sending keys, so the release render track stops failing on loaded runners.
