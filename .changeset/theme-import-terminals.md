---
"@sma1lboy/rove": patch
---

[cli] [tui] [web] Auto-detect and import color themes (background, foreground, cursor, ANSI 16 colors, and optional font family) from Ghostty, Kitty, Alacritty, and WezTerm configs via `rove theme import`, `rove theme add`, `rove api theme-import`, and Settings → Appearance → Theme in both the TUI and web client; `rove-web` applies imported `fontFamily` to its monospace UI and xterm.js terminals.
