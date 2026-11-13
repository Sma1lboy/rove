---
"@sma1lboy/rove": patch
---

Selecting text in an engine's session on the web now reaches your clipboard. An engine that takes the mouse draws its own selection and copies through the terminal, which the web terminal ignored: the engine said "copied" and nothing arrived, and the browser's own Copy was greyed out. The web terminal now takes that copy and puts it on the browser's clipboard.
