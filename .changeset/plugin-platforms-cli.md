---
"@sma1lboy/rove": patch
---

`rove plugin action invoke` and `plugin pane open` honour `platforms`. The
daemon's event host and the TUI's pane picker have always skipped a plugin the
manifest excludes from this machine; from a shell it ran anyway, so a
Windows-only plugin executed happily on macOS. Both now refuse with the
platforms the manifest declares, and `plugin link` warns when it registers
something nothing on this machine will run (a refusal would be wrong there —
developing a Windows plugin on a Mac is legitimate).
