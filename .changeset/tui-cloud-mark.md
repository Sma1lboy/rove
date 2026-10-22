---
"@sma1lboy/rove": patch
---

The TUI sidebar no longer splits tasks into a section per machine. The same repo on several machines is one project, every machine's tasks listed under it, and a task that lives on another machine shows a ☁ after its title (amber when that machine is offline or out of date). With the cursor on such a row the sidebar says which machine it is on and its state. Projects with different repos but the same folder name read `owner/name`, never `host:name`.
