---
"@sma1lboy/rove": patch
"@sma1lboy/rove-plugin-sdk": patch
---

Retire the former product namespace from packages, commands, configuration, and environment variables. Use `rove`, `@sma1lboy/rove`, and `@sma1lboy/rove-plugin-sdk` exclusively.

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
