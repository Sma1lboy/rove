---
"@sma1lboy/rove": patch
---

Remove remaining hard-coded vendor strings from neutral UI layers.

- Replace literal "Claude Code" / "Codex" / "claude" / "codex" product names in i18n messages, keybinding descriptions, and settings copy with vendor-neutral wording.
- Update example comments in `terminal.ts` and `keybindings-sidebar.ts` to avoid embedding vendor names.
- No behavior change; labels and descriptions now describe the generic concept instead of enumerating built-in engines.
