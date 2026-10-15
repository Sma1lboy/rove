---
"@sma1lboy/rove": patch
"@sma1lboy/rove-plugin-sdk": patch
---

`rove api tab-new --task-id ID --kind shell|engine [--command CMD]` opens a Terminal Tab with no first message: a login shell, or an engine that starts idle. It writes the tab row and spawns the session in one step, respects `engine.maxLiveSessions`, and returns the tab id. The bridge's `tab.new` op now takes an optional `prompt` and an optional `kind`, so iOS, Android and the web client can open a shell or an empty engine tab.

An attached TUI learns about the new tab through a new `tab.add` daemon channel, so it keeps the row instead of overwriting it or mistaking a headless shell for an engine tab. The plugin SDK lists the channel in `DAEMON_CHANNELS`.
