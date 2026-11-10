---
"@sma1lboy/rove": patch
---

The web app no longer re-reads every task's tabs each time the task list updates, which queued dozens of slow requests ahead of every click while engines were working. Tabs are read again only for a task whose tabs changed, and opening or closing a tab refreshes just that task. A pasted or dropped image now shows in the composer at once and rises in while it uploads, and on the New session page the attachments and the unsent prompt survive a reload. A click on the task list's right edge folds it, and a click on the page's left edge unfolds it.
