---
"@sma1lboy/rove": patch
---

Fix `rove api send` replying to the wrong tab on Windows. A `rove api` call made from an engine's Bash tool runs through the npm `sh` shim, and Git-Bash's fork exits the moment it execs `sh.exe`, so the CLI's parent chain reached a dead process before it reached the tab. Every task created that way recorded no dispatcher, and every bare `send` fell back to the active task — whatever tab you happened to be looking at. The console-membership repair that already re-links the engine to its tab shell now also runs on the CLI's own console, so the walk reaches the shell, `add` records the dispatcher, and `send` replies to the tab that dispatched the work. Process rows are now emitted in creation order so a console's root is chosen deterministically.
