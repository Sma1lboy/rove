---
"@sma1lboy/rove": patch
---

An agent can now retitle the task it runs in with `rove api update --title "…"` — no `--task-id` needed; outside a verified Rove session it asks for one. A project's main row shows its conversation title (or the title you gave it) instead of always showing the repo name, in the web rail and the TUI. Deleting a project's main row no longer reads "Remove project": it ends the conversation and closes its tabs while the project, repo, branches and worktrees stay (Remove project moved to the project header menu). When a task or a project main has child tasks, the web delete dialog now offers the TUI's choice: keep the children, or delete them too.
