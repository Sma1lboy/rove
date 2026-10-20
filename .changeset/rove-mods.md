---
"@sma1lboy/rove": patch
"@sma1lboy/rove-plugin-sdk": patch
---

Plugins can ship a **mod**: a `[mod]` process that draws panes of boxes, text and buttons, which the TUI and the web client both render natively from the same data. While a mod has a pane open, the sidebar rail shows a **Mods** page in both clients, and a button pressed in either one reaches the same process, so both redraw together. The plugin SDK adds `runMod()` with `Box`, `Text` and `Button`, plus `validateModTree()` on the contract subpath; `examples/counter-mod` is a working mod.
