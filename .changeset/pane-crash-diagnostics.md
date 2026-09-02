---
"@sma1lboy/rove": patch
---

Pane crash logs now keep React component names readable in minified builds and include the component stack plus a bounded, content-safe trace of recent daemon, KV, and tab-state changes. Production minification previously left React #185 reports with renderer-internal function names only.
