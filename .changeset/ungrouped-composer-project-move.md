---
"@sma1lboy/rove": patch
---

Web: the New session project picker starts with Ungrouped, which opens the session in no project (the rail's Ungrouped group, in the home directory). `rove api update --project PATH` moves an Ungrouped session under the project at PATH once it has cloned or created it; the session keeps its directory, so its engine resumes where it started.
