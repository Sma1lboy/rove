---
"@sma1lboy/rove": patch
---

A task row has the same name on the TUI, web, iPhone and Android. The bridge works out the name once (the engine's own conversation title, else the stored title, branch or path) and sends it as `label` on every task row. It pushes a new task list within a few seconds when an engine retitles its session. Before, the iPhone and Android apps named rows from the first words of the prompt, and the web only learned a new name after fetching that task's tabs.
