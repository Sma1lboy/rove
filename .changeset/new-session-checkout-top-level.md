---
"@sma1lboy/rove": patch
---

In the web client, New session with Worktree off now starts its own row in the project's group, running in the project's checkout and titled from its first prompt. Before, it opened a conversation on the project's main task, so once that task had a conversation the new session showed up nested under the main row. The bridge gains `task.openCheckout` for this, and `task.openDir` accepts a title.
