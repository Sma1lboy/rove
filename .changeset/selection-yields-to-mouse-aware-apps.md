---
"@sma1lboy/rove": patch
---

A terminal selection now gets out of the way of an app that owns the mouse. Selecting text at a shell prompt and then starting Claude Code, `vim` or `less` used to leave Rove's highlight painted on top of the app's own screen, and a drag begun before the app launched kept extending underneath it. Launching a mouse-aware app clears the pane's selection; drag-to-copy still works everywhere the app does not want the mouse, and `shift`+drag still selects out of one.
