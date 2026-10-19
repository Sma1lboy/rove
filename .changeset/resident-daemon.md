---
"@sma1lboy/rove": patch
---

`rove daemon start --resident` keeps the daemon running after the last TUI quits, for a devbox or VPS where agents run with no terminal attached. Residency survives `rove daemon restart`, Restart backend and a crash; only `rove daemon stop` ends it. With no front-end attached, `rove api prompt` now returns `reason: "no-gui"` at once instead of waiting out its timeout, and `pane-open`/`pane-close` report `reached: false` so a headless caller can tell nobody performed the split.
