---
"@sma1lboy/rove": patch
---

refactor(tui-react): extract Terminal host cursor and resize effects

`Terminal.tsx` was pinned at the 500-line file-size cap with zero
headroom. Move the resize-push-to-PTY effect and the macOS IME host
cursor-anchor effects into a new `use-terminal-host-cursor.ts` hook
so the component can focus on rendering and input handling.

No behavior change: all terminal render, IME cursor, and scrollback
tests pass. `Terminal.tsx` drops from 500 to 427 lines; the new hook
is 115 lines.
