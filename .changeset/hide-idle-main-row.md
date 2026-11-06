---
"@sma1lboy/rove": patch
---

Adding a project no longer shows a default session beside the task you asked for. A project's main row, the one for the repo itself, is listed only while it has a tab open, is selected, or has child tasks under it; otherwise the project header and its tasks are all you see. The main task still exists, so `rove api send` to it works and its row appears once it has a tab. Reorder and Move to top still work from the project header.
