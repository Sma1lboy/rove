---
"@sma1lboy/rove": patch
---

Linking an issue to a task that does not exist is now refused, and deleting a task unlinks its issue. `rove api issue-update --task <id>` accepted any string, so a typo'd id parked the card in In progress pointing at nothing; deleting a linked task left the same dead link behind, because nothing ever cleared it. Both paths are fixed at the RPC the CLI and the web board share, and the kanban board now treats a link the task list cannot resolve as unlinked, so a card stranded by an older build falls back to Backlog where Start works again. The story drawer also gains an Unlink action next to "Open the linked session", so a stranded story is recoverable without the CLI.
