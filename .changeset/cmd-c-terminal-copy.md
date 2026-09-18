---
"@sma1lboy/rove": patch
---

Command+C no longer types a literal `c` in the terminal, and Ctrl+C copies a selection on every platform

macOS Command arrives over the kitty keyboard protocol as `super`, not `meta`. The keymap read only `meta`, so Command was invisible: `cmd+c` degraded to the bare chord `c`, matched the terminal passthrough, and typed a literal `c` into the session. The same hole left every `cmd+…` chord dead on macOS — `cmd+v` typed a `v`. Command is now read as `cmd+`, and a Command-modified character is dropped rather than typed.

Ctrl+C with an active selection now copies on macOS and Linux too. That behaviour already existed but was gated on Windows, while the condition that matters is whether a selection exists — Rove draws the selection itself, so no terminal emulator knows to claim the chord first. Copying clears the selection, so the next Ctrl+C interrupts as before, and Ctrl+C with nothing selected is always an interrupt.

`ctrl+shift+c` also copies the selection, on terminals that speak the kitty keyboard protocol.
