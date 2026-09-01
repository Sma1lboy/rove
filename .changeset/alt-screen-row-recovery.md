---
"@sma1lboy/rove": patch
---

Keep the whole screen a stuck engine was showing, not just its last line

A task waiting on a dialog recorded one readable line of its death record —
the `Enter to confirm · Esc to cancel` footer — with the question, its
options, and the reason all missing. The tail budget was 40 lines and it kept
1: an engine painting a full screen moves the cursor instead of writing
newlines, and stripping the escapes first collapsed every row into one line.
Vertical cursor motion now becomes a row break before the escapes are
stripped, so `rove api read-output` and a dead tab's recorded tail both show
the screen the engine was actually on.
