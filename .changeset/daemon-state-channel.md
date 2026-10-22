---
"@sma1lboy/rove": patch
---

A setting changed anywhere (another TUI, the web, a phone, a CLI verb, a hand edit of state.json) now applies to every running TUI at once. The daemon publishes the shared state file on a new `state` channel and the TUI follows it instead of keeping the copy it read at launch; per-window layout (rail fold and width, zen) stays per window.
