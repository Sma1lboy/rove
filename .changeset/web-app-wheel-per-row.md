---
"@sma1lboy/rove": patch
---

Scrolling a fullscreen engine in the web terminal (Claude Code with `"tui": "fullscreen"`, or any app on the alternate screen) now keeps up with the wheel: the app gets one wheel event per row of travel, as in the TUI, where it used to get one per browser event and about a quarter of a trackpad's travel. A notch of a mouse wheel is three rows.
