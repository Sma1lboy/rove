---
"@sma1lboy/rove": patch
---

A Rove install predating the `.kobe` → `.rove` move still finds the daemon,
the PTY host and its plugins. The new runtime paths are invisible to an older
binary, and an invisible daemon isn't an error it reports — it's a second
daemon it starts on the same task index, or a second PTY host that splits your
engine tabs. Each bind now leaves a symlink at the legacy path (never
clobbering a real file there, which would be another daemon's live socket),
and the migrated plugin tree is linked back the same way.
