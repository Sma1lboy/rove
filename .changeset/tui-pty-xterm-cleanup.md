---
"@sma1lboy/rove": patch
---

Collapse `XtermTaskPty.feed` and `feedReplay` into one private `feedInternal` helper in the TUI terminal base, and remove an unnecessary `IMarker` cast in scrollback anchor math.
