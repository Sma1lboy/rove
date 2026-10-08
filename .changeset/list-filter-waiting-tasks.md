---
"@sma1lboy/rove": patch
---

`rove api list` takes `--repo`, `--status` and `--activity` filters, so `rove api list --activity permission_needed,error` answers "which tasks are waiting on me" in one call, each match carrying the engine state it matched.
