---
"@sma1lboy/rove": patch
---

The tab strip's completion chip now reads the same saved "already looked at" timestamps as the sidebar lamp, so quitting Rove no longer wipes what you had read: a `✓` you already consumed comes back as `○`, and a turn that finished while you were away still announces itself. Persisted UI state is also flushed on exit — writes were debounced 250ms, so anything changed in the last quarter-second before quitting (the seen mark most of all) used to be lost.
