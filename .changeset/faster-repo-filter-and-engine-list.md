---
"@sma1lboy/rove": patch
---

`rove api list --repo` no longer walks every saved repo with two serial `git` spawns (1,211 ms → 200 ms at 32 repos), and `engine-list` remembers each engine's model catalog instead of re-probing it on every call (7–10 s → 0.1 s warm).
