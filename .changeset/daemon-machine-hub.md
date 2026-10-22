---
"@sma1lboy/rove": patch
---

`rove machine add` and `rove machine remove` now reach every open TUI, the web app and a paired phone within a second or two, no restart. The daemon holds the machine connections and publishes them on a new `machines` channel; clients no longer connect to other machines themselves.
