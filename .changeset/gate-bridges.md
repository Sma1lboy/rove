---
"@sma1lboy/rove": patch
---

Decision gates can now be answered from the phone and from WeChat. The Android and iOS Inbox show each open decision with its question; tapping one opens an answer sheet with the options (the recommended one marked) and an optional note instead of dismissing it, and the answer reaches the task like `rove api gate-answer`. In WeChat, `gates` lists open decisions with their option keys, `answer g-12 b [note]` answers one, and a newly opened decision is pushed to you. The bridge carries `gates` in its task payload and a new `gate.answer` op, and refuses to dismiss a decision from the Inbox.
