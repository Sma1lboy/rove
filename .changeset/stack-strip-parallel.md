---
"@sma1lboy/rove": patch
---

[web] [ios] The stack strip at the top of a session shows sessions dispatched in parallel as one group, `parent ← { a | b | c }`, instead of chaining each child onto the previous one. Opening a child now shows its siblings too, and the open session's own children follow it. The strip stays on one line: long titles end in an ellipsis and a long chain scrolls sideways, keeping the open session in view.
