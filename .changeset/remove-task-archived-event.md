---
"@sma1lboy/rove": patch
"@sma1lboy/rove-plugin-sdk": patch
---

Remove the `task.archived` plugin event and archive diff field

The archive concept is being retired (issue #75). As the first slice, this
change removes the public plugin contract surface:

- `task.archived` is no longer emitted from the daemon's snapshot-diff reducer.
- `archived` is removed from the watched task-diff fields, so `task.changed`
  will no longer include `archived` in `detail.fields`.
- The event is removed from `@sma1lboy/rove-plugin-sdk`'s `PLUGIN_EVENT_NAMES`
  catalog.
- Plugin-author docs (`PLUGIN-AUTHORING.md`, `PLUGIN-EVENTS.md`, and
  `docs/design/plugin-events.md`) no longer list `task.archived`.

**Breaking change for plugins:** any plugin subscribing to `task.archived` will
stop receiving that event. Use `task.changed` / `task.deleted` / `worktree.created`
if you need to observe task lifecycle or worktree transitions.
