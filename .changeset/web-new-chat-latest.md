---
"@sma1lboy/rove": patch
---

In the web client, "New conversation" (the tab strip's +, a task's menu, an empty task) opens a tab right away on the engine the project used last, as ctrl+t does in the TUI. Picking another engine, forking or starting in Scratch is "New conversation with…" in the task menu, a right-click on +, or ctrl+e. `rove api tab-new --kind engine --latest` and the bridge's `tab.new` with `latest: true` open a tab the same way.
