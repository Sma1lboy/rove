---
"@sma1lboy/rove": patch
---

A split pane where you started an engine by hand (say `codex` in the shell `tab-split` opened) is now named for that engine, on the web and in the TUI, instead of `shell`. The name comes from the same process check that names a tab's engine, and `rove api get-task` reports it as `liveVendor` on each split shell pane in `.tabs[].split`.
