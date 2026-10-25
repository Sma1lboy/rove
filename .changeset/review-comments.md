---
"@sma1lboy/rove": patch
---

`rove api review-comments --task-id <id>` lists the unresolved review threads on a task's PR, each with its file, line and conversation, so an agent can work through review feedback without its own `gh` calls.

Paginated reads can exceed 20 seconds without timing out or disconnecting the daemon client.
