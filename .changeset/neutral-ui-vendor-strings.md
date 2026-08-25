---
"@sma1lboy/rove": patch
---

Remove hard-coded vendor strings from neutral UI layers and introduce a named default-theme constant.

- `DEFAULT_TASK_VENDOR` now backs the fallback engine selection in `new-task-dialog/pure.ts` and `new-chat-dialog.tsx` instead of the literal `"claude"`.
- `DEFAULT_THEME` is exported from `tui/context/theme-core.ts` and used by the React theme provider and host-boot fallback instead of hard-coding `"claude"`.
- `AccountsSettingsSection` now receives the same `displayName` resolver used by `EngineSettingsSection`, so account block labels respect custom name overrides and built-in registry labels instead of literal `"claude-code"` / `"codex"` / `"copilot"` / `"kimi"`.
- The "no engine detected" toast in `task-create-flow.ts` no longer names specific vendors.
