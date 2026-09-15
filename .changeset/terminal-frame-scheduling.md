---
"@sma1lboy/rove": patch
---

Keep terminal input responsive during continuous output. Visible terminals now build their latest snapshot and commit changed rows in the same OpenTUI frame, instead of waiting for a separate snapshot timer and then another render deadline. Hidden or closed panes cancel queued work, and returning to a pane still captures its latest output.
