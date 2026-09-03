---
"@sma1lboy/rove": patch
---

Order the durable PTY/engine death records by a proper strict-weak comparator so `rove api inspect` and the retention cap agree on "newest first". Both read sites sorted with a non-transitive `a.at < b.at ? 1 : -1` shorthand that claimed each of two same-instant records preceded the other; a burst of engine deaths the activity observer stamps in one sweep therefore landed in an engine-defined order, and at the 50-record cap which of that tied burst survived was arbitrary. A single shared comparator ties on equal timestamps and keeps the stable order, so the two sites can no longer drift.
