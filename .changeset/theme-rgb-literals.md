---
"@sma1lboy/rove": patch
---

Accept `rgb()` and `rgba()` colours in theme files

A theme slot or `defs` entry can now be written `rgb(134, 225, 252)` or `rgba(134, 225, 252, 0.5)` anywhere a `#hex` was accepted, on both the colours the TUI renders and the ones exported for external styling. Alpha follows CSS as a 0-1 fraction.

Components outside 0-255 (or an alpha outside 0-1) are refused by name rather than clamped, so `rgb(300, 0, 0)` reports itself as a bad literal instead of falling through to the def-name lookup and rendering black.
