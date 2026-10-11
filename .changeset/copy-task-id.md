---
"@sma1lboy/rove": patch
---

Right-clicking a task or tab row in the sidebar now offers **Copy task ID**, which puts the id that `rove api read-output --task-id`, `watch --task-ids` and the other task verbs take on the clipboard, so you can address a task from another shell or hand it to an agent without looking it up in `rove api list`.
