---
"@sma1lboy/rove": patch
---

Render every OpenTUI screenshot and recording through a renderer that supports
xterm custom block glyphs. The shared harness now selects WebGL for opaque
captures and Canvas for transparent captures, so engine banner logos no longer
split into strips when a capture entry point omits its own renderer flag.
