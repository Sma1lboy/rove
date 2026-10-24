---
"@sma1lboy/rove": patch
---

An engine Rove cannot identify (a custom launch command) now shows the `Engine exited` strip with Retry in the TUI and the web whenever it dies. Rove used to watch for the exit banner only in a launch's first five minutes, and not at all for a launch started while the daemon was still booting (the common `rove api add` case), so the tab sat at a bare shell. Only the wrapper's own banner row counts, so typing or printing that text in the fallback shell does not mark the tab dead.
