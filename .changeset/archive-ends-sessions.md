---
"@sma1lboy/rove": patch
---

Archiving a task now ends its sessions. Every engine and shell process of the task and its child tasks is stopped; the worktree, branch and conversations are kept, and a tab reopens its conversation after you unarchive. A task that is still working asks first, and `rove api archive --force` stops it. Removing a project also closes the sessions that ran in its main checkout.
