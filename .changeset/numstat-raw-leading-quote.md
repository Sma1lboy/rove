---
"@sma1lboy/rove": patch
---

A changed file whose name begins with a literal double-quote now keeps its +/- line counts in the file tree and sidebar instead of silently losing them. `git diff --numstat -z` emits raw paths, so such a name was being mistaken for a quoted one and mangled, orphaning its counts from the status row.
