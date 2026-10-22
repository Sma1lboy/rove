---
"@sma1lboy/rove": patch
---

`rove api issue-*` now belongs to the Kanban mod and `rove api workitem-*` to the Issues mod. Until the mod is installed those verbs are left out of `rove api schema` and `--help`, and calling one fails with `MOD_NOT_INSTALLED` and the `rove plugin install` command that fixes it; the daemon refuses the matching RPCs the same way, so the web and other machines get the same answer. Without Kanban, deleting a task or marking it done no longer touches the issue store, which stays as it was for a later install.
