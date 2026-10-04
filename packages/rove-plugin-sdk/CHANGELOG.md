# @sma1lboy/rove-plugin-sdk

## 0.1.9

### Patch Changes

- [#1201](https://github.com/Sma1lboy/rove/pull/1201) [`1bfc6c3`](https://github.com/Sma1lboy/rove/commit/1bfc6c30048a578bb1123fa3c9de1de9d3b97a00) Retire the former product namespace from packages, commands, configuration, and environment variables. Use `rove`, `@sma1lboy/rove`, and `@sma1lboy/rove-plugin-sdk` exclusively.

  Removed compatibility interfaces, using `former` for the retired product spelling documented in the npm note in `docs/agents/dev-loop.md`:

  - CLI: `former`, `dev:former`, `daemon:former`, `src/cli/former.ts`, and the invocation/environment compatibility wrapper.
  - Packages: `@sma1lboy/former-daemon`, `@sma1lboy/former-docs`, `@sma1lboy/former-landing`, `former-harness`, `former-branding`, the SDK package alias, and all six `packages/former*` directories. Use their `rove` equivalents.
  - Repository files: `.former/init.sh`, `init-prompt.md`, `pr-instructions.md`, and `ci-instructions.md`; `former-plugin.toml`; the `former-plugin` marketplace topic.
  - SDK: `former()`, `formerJson()`, `FormerSocket`, `FormerSocketOptions`, `FormerRunOptions`, and `FormerRunResult`. Use the corresponding Rove exports.
  - Fields: `formerVersion`, `formerManaged`, and `min_former_version`. Use `roveVersion`, `roveManaged`, and `min_rove_version`.
  - Paths: `~/.former`, `~/.config/former/state.json`, `.agents/skills/former`, `.claude/skills/former`, former-named shell completions, runtime sockets, Windows named pipes, temporary sockets, logs, and developer fixtures. New processes create only Rove names; repository-file and skill fallbacks are removed.
  - Environment: all variables with the retired uppercase product prefix are removed. The following observed suffixes now use only `ROVE_`; existing canonical twins are kept once:

  ```text
  ANTHROPIC_API_KEY, BIN_PATH, BRAND_THEME, CHAT_ENGINE, CLI, CODEX_HOOK_EVENTS, COMMAND,
  CONFIG_DIR_BASENAME, COVERAGE_DAEMON, COVERAGE_MIN, DAEMON_AUTOSPAWNED, DAEMON_IDLE_GRACE_MS,
  DAEMON_PID_PATH, DAEMON_SOCKET_PATH, DAEMON_SPAWN_REASON, DAEMON_WEB_PORT, DEBUG, DEV, DIR,
  ENGINE_STATE_TTL_MS, ENV_PREFIX, FAKE_UPDATE, HOME, HOME_DIR, HOOK_DEBUG, HOOK_EVENTS, I18N,
  INCLUDE_BEHAVIOR, INCLUDE_SOCKET, INVOKED_AS, ISSUES_TODAY, KEYCHAIN_SERVICE, KIMI_HOOK_EVENTS,
  NOTIFY_DELAY, NOTIFY_QUIET, NOTIFY_SOUND, NOTIFY_TITLE, OPEN_EDITOR, PLUGIN_, PLUGIN_ACTION_ID,
  PLUGIN_CONFIG_DIR, PLUGIN_ENTRYPOINT_ID, PLUGIN_EVENT, PLUGIN_EVENT_JSON, PLUGIN_ID,
  PLUGIN_OPENAI_KEY, PLUGIN_ROOT, PLUGIN_STATE_DIR, PLUGIN_TASK_ID, PROBE, PRODUCT_NAME, PTY_CAST,
  PTY_DEV_COMMAND, PTY_DEV_CWD, PTY_DEV_SHELL, PTY_IDLE_EXIT_MS, PTY_MAX_LIFETIME_MS, PTY_PARENT_PIPE,
  PTY_PID_PATH, PTY_PORT, PTY_SOCKET_PATH, RENDER_COVERAGE, REPLAY_CLAUDE_COMMAND, REPLAY_E2E,
  RESUME_CWD, SANDBOX_HOME_DIR, SKILL_VERSION, SKIP_DEP_CHECK, SOCKET_PATH, STATE_DIR_BASENAME,
  TAB_ID, TASK_ID, TERMINAL_BACKEND, TERMINAL_PIPE, TERMINAL_PTY, TERMINAL_TITLE_SEQUENCE,
  TEST_ENGINE, TEST_FAKE_PORT, TMUX, TMUX_SOCKET, TUI, UPDATE_GOLDEN, VISUAL, VISUAL_FRESH,
  VISUAL_KEEP, VISUAL_MIN_PATH, VISUAL_PORT_BASE, WEB_HOST, WEB_PORT, WORKTREE_ROOT_SUBPATH
  ```

  Temporary compatibility, remove next minor: the internal `LEGACY_PRE_RENAME_RUNTIME_NAME` constant permits attachment to already-running pre-rename PTY hosts and access to their existing state. Canonical endpoints are tried first. Nothing creates a legacy listener or compatibility symlink. The running PTY host retains its boot-time build and sessions until it exits or `rove reset` runs.

  Deployment owners must change the docs and landing Vercel projects' Root Directory settings to `packages/rove-docs` and `packages/rove-landing` respectively. Dashboard settings are not changed by this patch.

  After import, non-live sources move out of the retired state directories. Conflicting bytes are preserved under `.rove/migration-conflicts`; live runtime files and existing Git worktrees retain their addresses. Retirement retries independently of import markers. — [@Sma1lboy](https://github.com/Sma1lboy)

## 0.1.8

### Patch Changes

- [#903](https://github.com/Sma1lboy/rove/pull/903) [`586bd67`](https://github.com/Sma1lboy/rove/commit/586bd67db212d3cc1e1883f8c37344e745da056c) Settle pending socket requests when a plugin closes or loses its connection. Reconnecting the same client isolates the new connection from late socket events, and invalid JSON frame shapes no longer crash plugin subscribers. — [@Sma1lboy](https://github.com/Sma1lboy)

## 0.1.7

### Patch Changes

- [#850](https://github.com/Sma1lboy/rove/pull/850) [`a5b552c`](https://github.com/Sma1lboy/rove/commit/a5b552cd15c8df9848b6e7f76aee1e30d34793c3) `usage.context` joins the SDK's `DAEMON_CHANNELS`. The channel shipped in the
  daemon but the published SDK never learned the name, so a plugin typed against
  it could not subscribe — and the daemon drops unknown channel names from a
  filter rather than rejecting them, so the subscribe succeeded and the channel
  simply never arrived, with no error anywhere. Documented alongside the drop
  behaviour in the SDK's channel list. — [@Sma1lboy](https://github.com/Sma1lboy)

## 0.1.6

### Patch Changes

- [#623](https://github.com/Sma1lboy/rove/pull/623) [`bb40b81`](https://github.com/Sma1lboy/rove/commit/bb40b8101982f3c5b0ec5b9f4aed8137eb2bcabb) Remove the `task.archived` plugin event and archive diff field

  The archive concept is being retired (issue [#75](https://github.com/Sma1lboy/rove/issues/75)). As the first slice, this
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
  if you need to observe task lifecycle or worktree transitions. — [@Sma1lboy](https://github.com/Sma1lboy)

## 0.1.5

### Patch Changes

- [`be26ebe`](https://github.com/Sma1lboy/rove/commit/be26ebe5f76dc3a8fb83100006a1839e3842e558) Add two runnable SDK example plugins under `examples/`:
  `turn-notify` demonstrates `turn.complete` / `agent.permission-needed` hooks,
  reading `detail.turn` usage, and toasting via `notify()`;
  `settings-demo` declares string/enum/boolean settings and prints the effective
  config from an action entrypoint using `readSettings()` / `setting()`.
  Also adds an `examples/README.md` index covering all three examples. — [@Sma1lboy](https://github.com/Sma1lboy)

- [`db4191c`](https://github.com/Sma1lboy/rove/commit/db4191cb39b1c7c04fa67b7d3636a5a1a88f0bdd) Add two runnable SDK example plugins:

  - `examples/task-board` — a `[[panes]]` plugin that draws a live task board
    from `task.snapshot` and `engine-state`, plus a headless `snapshot`
    `[[actions]]` entry that prints one frame for verification.
  - `examples/contrib-engine` — a manifest-only `[[engines]]` plugin that
    contributes a fake engine with identity and screen-state rules.

  `rove api engine-list` now includes engines contributed by enabled plugins,
  so plugin engines are visible alongside built-ins and registered presets. — [@Sma1lboy](https://github.com/Sma1lboy)

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
