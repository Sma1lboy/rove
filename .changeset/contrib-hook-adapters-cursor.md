---
"@sma1lboy/rove": patch
---

Engines outside the built-in six can now install activity hooks, and Cursor Agent is the first to do it.

A shipped catalog engine may declare a `createHookAdapter` next to its screen rules. Cursor uses it to install one `sessionStart` hook into `~/.cursor/hooks.json` (or `CURSOR_CONFIG_DIR`), which reports the live cursor session for a worktree. Its screen rules keep owning the working / needs-input badge, and cursor's remaining hook events gate the agent's own actions, so Rove installs no observer on them.

The merge preserves entries you or another tool wrote, adds nothing on a second launch, and creates no `~/.cursor` for a machine without the CLI. Engines that declare no adapter — Gemini CLI, OpenCode, Grok CLI, Droid, Amp — behave exactly as before.

`rove doctor` now asks each adapter to judge its own hook file instead of running one JSON validator over every file named `.json`, which had reported Cursor's valid `hooks.json` as broken.
