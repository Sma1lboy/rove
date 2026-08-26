# @sma1lboy/rove-plugin-sdk

## 0.1.4

### Patch Changes

- [#557](https://github.com/Sma1lboy/rove/pull/557) [`2794d3a`](https://github.com/Sma1lboy/rove/commit/2794d3aea2504c7962f03e5f69a499ef01bf2961) Plugins now see the whole product move, not just the corners a handler
  remembered to report. Task events derive from field-level snapshot diffs, so
  `task.archived` fires however a task got archived (including the
  `git worktree remove` sweep and `land --then-archive`) and `worktree.created`
  fires for adopted worktrees too — both previously dropped. New catalog
  entries: `task.changed` (fields/from/to), `task.pr-changed`,
  `automation.dispatched/skipped/failed`, `quota.exhausted/resumed`,
  `session.exited` (the crash signal, off the PTY host's death records),
  `note.filed`, `message.delivered`, `attention.handled`, and
  `plugin.enabled/disabled`. `turn.complete` now carries the finished turn's
  model + token usage. Manifests gain `[[shutdown]]` hooks (bounded ~3s at
  daemon stop) and `[engines.identity]` for composer copy, and
  `rove api engine-report` lets a plugin-contributed engine drive the sidebar
  badge, attention inbox, and event stream without a built-in hook adapter. — [@Sma1lboy](https://github.com/Sma1lboy)

- [`6ebc1e7`](https://github.com/Sma1lboy/rove/commit/6ebc1e70a7a8b525992c418dbdc7c4838809e6f8) Named plugin sandboxes: `bun plugin-sandbox <name> <link|run|api|smoketest|home|reset>`
  gives every plugin-dev or demo-recording task its own isolated home, daemon,
  PTY host, plugin registry, and web port under `.scratch/plugin-sandbox/<name>` —
  parallel sandboxes never collide with each other, the shared dev sandbox, or
  production. The SDK ships a first runnable example
  (`examples/hello-events`), and `smoketest` proves the whole chain end to end:
  link the example, boot a fresh daemon, fire `issue.changed`, assert the hook
  saw it. — [@Sma1lboy](https://github.com/Sma1lboy)

## 0.1.3

### Patch Changes

- db4acbd: Point new installs, package metadata, documentation, release links, and website GitHub data at the canonical `Sma1lboy/rove` repository. Existing `Sma1lboy/kobe` links continue to work through GitHub's redirect, while the Kobe CLI, packages, state, plugin repository, and deployed website domains remain compatible.

## 0.1.2

### Patch Changes

- bc284d4: Make Rove the canonical plugin-authoring surface without breaking existing plugins: new manifests use `rove-plugin.toml` and `min_rove_version`, marketplace discovery searches `rove-plugin`, plugin commands receive `ROVE_PLUGIN_*`, and the bundled agent skill installs as `rove`. Legacy Kobe manifests, topics, environment variables, skill paths, and SDK imports remain supported; the SDK now publishes the same artifact as both `@sma1lboy/rove-plugin-sdk` and `@sma1lboy/kobe-plugin-sdk`.

## 0.1.1

### Patch Changes

- c9fbcb4: Contract catalog gains `task.landed`, `task.archived`, `issue.changed`, `tab.opened`, `tab.closed`, and `file.closed`.
- ad192f9: `promptUser(title, opts)` — the host input dialog as one typed call; contract catalog gains the `ui.prompt` channel.
