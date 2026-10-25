---
"@sma1lboy/rove": patch
---

Re-running `rove api land --strategy squash` on a multi-repo task that stopped at a conflict now carries on with the remaining repos: a repo whose squash already landed reads as `skipped` instead of failing the whole run with "nothing to land".
