---
"@sma1lboy/rove": patch
---

Keep a live task in the Inbox's RECENT list after you close the last tab you visited it through. Visiting a task records a per-tab entry, and a RECENT row whose tab has since closed is dropped so several closed tabs of one task don't read as duplicate rows — but when every visited tab of a task was closed, the task was still counted as "seen" and so fell out of the task-level fallback too, disappearing from the Inbox entirely even though it was still open. It now falls back to a single task-level RECENT row, exactly like a task you never visited.
