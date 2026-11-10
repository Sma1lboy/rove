---
"@sma1lboy/rove": patch
---

Deleting a task with many children in the web app no longer fails with "daemon connection closed" and a rail that suddenly lists every project. A burst of task-list reads over one daemon connection now shares a single request, so the daemon no longer drops that connection for queueing too many copies of the list.
