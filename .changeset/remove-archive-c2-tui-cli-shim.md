---
"@sma1lboy/rove": patch
---

Remove the remaining archive concept from the TUI, CLI, and type shim (issue #75 slice C2).

- Remove the `archived?: boolean` shim from `Task`. The field is no longer part of the task model.
- Remove the `rove api archive` verb and the `land --then-archive` flag.
- Remove all `task.archived` filters from the TUI (`tui/`, `tui-react/`) and the CLI (`export`, `collect`, etc.).
- Remove the no-op `setArchived` shims from `Orchestrator`, `TaskEditor`, `RemoteOrchestrator`, and `DaemonOrchestrator`.
- Update user-facing docs (API, CLI, Concepts, Sessions, Design, Orchestration, Configuration, plugin events, daemon/task design) to remove archive references.
- `rove export` no longer emits an `archived` column/field.
- Data compatibility: `tasks.json` files that still carry `archived` continue to load without error; the field is ignored by the codec and dropped on the next save.
