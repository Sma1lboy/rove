---
"@sma1lboy/rove": patch
---

Remove outdated workaround constraints in `tui/` and `tui-react/`.

- `tui/ops/activity-monitor.ts`: drop the dead `@kobe_tab_state` tmux window-option constant and update IO docs; turn state now feeds React consumers, not tmux.
- `tui/lib/keymap-overrides-parse.ts`: remove the `allowShiftCharacter` normalization option that only existed for the deleted tmux-layer resolver, and delete the unused `chordOptsFor` override hook.
- `tui-react/context/notifications.tsx`: read sound/toast toggles from the ported React KV provider when one is present, falling back to the mount-time `state.json` snapshot only in test/mock hosts that intentionally omit `KVProvider`.
