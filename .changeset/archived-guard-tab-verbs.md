---
"@sma1lboy/rove": patch
---

[cli] [daemon] `rove api tab-new` and `tab-split` on an archived task are now refused with `TASK_ARCHIVED`, like `send` and `tab-revive`: nothing starts until the task is unarchived.
