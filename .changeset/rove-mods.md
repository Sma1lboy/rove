---
"@sma1lboy/rove": patch
"@sma1lboy/rove-plugin-sdk": patch
---

Plugins can ship a **mod**: a `[mod]` process that draws panes of boxes, text, buttons and one-line input fields, which the TUI and the web client both render natively from the same data. While a mod has a pane open, the sidebar rail shows a **Mods** page in both clients; a button pressed or a note typed in either one reaches the same process, so both redraw together. A running mod can also subscribe to plugin events directly. The plugin SDK adds `runMod()` with `Box`, `Text`, `Button` and `Input`, `mod.on()` for events, and `validateModTree()` on the contract subpath; `examples/counter-mod` is a working mod.

A plugin's input dialog (`rove api prompt`, `promptUser()`) now also opens in the web client, so a plugin can ask a question when only a browser is attached.
