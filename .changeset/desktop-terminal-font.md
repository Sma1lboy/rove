---
"@sma1lboy/rove": patch
---

The desktop app draws terminal text at full size. Its Chromium rejected the canvas font the WebGL renderer sets for upright glyphs (it starts with a space), so regular and bold text fell back to 10px sans-serif.
