---
"@sma1lboy/rove": patch
---

A dead engine now offers a way forward. When an engine exits into its fallback shell (`Engine exited (code N)`, including a launch command that never starts), the web and the TUI show Retry, Settings → Engines and New conversation with another engine; `rove api tab-revive --restart-exited` is the relaunch behind Retry. A task that never ran an engine is marked dead within seconds instead of only after a daemon restart. Every hosted session now falls back to the same shell when `$SHELL` is unset, so a shell-function preset such as `claudecpa` relaunches the way it first launched. The web terminal no longer types `1;2c`-style terminal query replies into the shell after a reattach.
