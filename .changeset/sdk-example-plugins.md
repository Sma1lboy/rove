---
"@sma1lboy/rove": patch
"@sma1lboy/rove-plugin-sdk": patch
---

Add two runnable SDK example plugins:

- `examples/task-board` — a `[[panes]]` plugin that draws a live task board
  from `task.snapshot` and `engine-state`, plus a headless `snapshot`
  `[[actions]]` entry that prints one frame for verification.
- `examples/contrib-engine` — a manifest-only `[[engines]]` plugin that
  contributes a fake engine with identity and screen-state rules.

`rove api engine-list` now includes engines contributed by enabled plugins,
so plugin engines are visible alongside built-ins and registered presets.
