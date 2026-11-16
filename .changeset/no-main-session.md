---
"@sma1lboy/rove": patch
---

A project no longer has a "main" session of its own. Opening a project (`rove .`, New task → Open, the web's Open project, a Kanban story started in the project checkout) starts a new session in its checkout every time, listed like any other session: it can be pinned, moved to another project, archived and removed. Existing main sessions become ordinary sessions on the first start after the update; one that had no tab open, no child task and was not archived is dropped, and your project order is kept.

`rove api send --repo PATH --prompt "…"` starts a session in that project's checkout and delivers the prompt there. It replaces sending to a project's main row, which no longer exists. `rove api list` never reports `kind: "main"`.

A project header's menu has Move to top, Move up and Move down in place of Reorder project. The Kanban "New worktree as a chattab in the project workspace" placement is gone, since there is no project workspace to put the tab in. Plugins no longer receive `project.opened`; entering any session sends `task.opened`.
