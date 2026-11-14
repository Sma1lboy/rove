---
"@sma1lboy/rove": patch
---

Web: a terminal that fell behind on output (a burst of output, or the page in a background tab while the agent worked) no longer comes back mostly blank with stray characters. Catching up replaces the screen from a buffer that begins partway through a redraw; the agent is now asked to redraw afterwards, as it already was on reconnect.
