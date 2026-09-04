---
"@sma1lboy/rove": patch
---

`$ROVE_BIN_PATH` now points at the Rove that is actually running. The daemon
handed plugins the literal name `kobe` — even when started as `rove` — so a
hook resolved whichever install happened to sit first on `PATH`. On a machine
with two of them (a global npm install beside a `bun add -g` or a worktree
build) hooks silently drove the wrong version, and a plugin calling
`listTasks()` could autospawn that other version's daemon into this daemon's
home. Both the daemon and `rove plugin action invoke` now resolve one absolute
path where the entry point is runnable on its own — an npm install, a compiled
binary — and fall back to the invoked name only for a dev checkout, which has
no single token to exec. Documented in the plugin env table.
