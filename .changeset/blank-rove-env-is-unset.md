---
"@sma1lboy/rove": patch
---

Treat a blank `ROVE_*` environment variable as unset instead of as a value.
`VAR=` is how a shell says "unset", but `readRoveEnv` resolved the two
namespaces with `??`, so a defined-but-empty `ROVE_*` shadowed the real
`KOBE_*` beside it — and the mirror step copied the blank over it as well.
For `HOME_DIR` that produced `""` as the home and then state paths relative
to the process's cwd (the user's repository, for the TUI), in a module that
`renameSync`s the plugin tree; for the daemon/PTY socket and pid overrides it
dropped an isolated run back onto the production daemon.

An engine switched off in Settings → Engines is now also skipped by
`rove api add`'s repo default, and a `ui-prefs` payload from an older daemon
no longer turns remote panes opaque.
