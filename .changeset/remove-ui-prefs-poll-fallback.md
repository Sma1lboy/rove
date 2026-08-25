---
"@sma1lboy/rove": patch
---

refactor(daemon): remove the deprecated `pollMs` fallback from ui-prefs and file-watch-trigger

- `file-watch-trigger.ts` no longer accepts the ignored `pollMs` option (chokidar's directory watch + startup signature catch-up replaced the bespoke poll safety-net).
- `ui-prefs-watcher.ts` drops its `pollMs` option and `DEFAULT_UI_PREFS_POLL_MS`; the watcher now relies on the directory watch, matching the actual implementation.
- No behavior change: the poll path was already a no-op.
