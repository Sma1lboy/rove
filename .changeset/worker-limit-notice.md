---
"@sma1lboy/rove": patch
---

- A session that dispatched a worker now hears when that worker stops on its engine's usage or billing limit: one `[ROVE WORKER]` line in its tab says when Rove resumes the worker automatically, that no reset is known, or that a billing stop needs a human, so the coordinator neither waits on silence nor re-dispatches work that will continue.
