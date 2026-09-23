---
"@sma1lboy/rove": patch
---

Terminal size is now read through one shared resize listener instead of one per component, so the "MaxListenersExceededWarning: 11 resize listeners" message no longer prints over the TUI once a second terminal task opens.
