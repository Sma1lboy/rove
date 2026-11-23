---
"@sma1lboy/rove": patch
---

Web: closing a terminal that had fallen back to the Canvas renderer (no WebGL, or after the browser's GPU process reset) no longer throws and leaves its empty box behind. The page's Content-Security-Policy no longer lists `http://[::1]:*`, which browsers reject with a console error; an address typed as `[::1]:port` in the Browser panel opens as `localhost:port`.
