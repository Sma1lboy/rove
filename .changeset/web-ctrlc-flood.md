---
"@sma1lboy/rove": patch
---

Web: Ctrl+C on a terminal flooding output stops in about 0.2s instead of 2-3s. The page now acks the output it has drawn, and the bridge stops sending once about 1 MB is unacknowledged, then repaints the newest screen from the session's ring when the page catches up.
