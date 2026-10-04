---
"@sma1lboy/rove": patch
---

Typing into a terminal tab does half the React work per key. The terminal body re-attached its measuring ref on every render, and each re-attach scheduled a second render; it now does that only until the pane has its first real size, so each keystroke's echo renders once instead of twice, and a task switch renders about once less.
