---
"@sma1lboy/rove": patch
---

docs: update stale Solid/tmux/ChatTab references in orchestrator and kobe-daemon comments

- Replaced "Solid signal" with "Observable state" in `orchestrator/core.ts`.
- Updated `kobe-daemon` comments to stop describing the current architecture in terms of the removed tmux/ChatTab stack (lifetime policy, PTY host, transcript collector, protocol roles, log paths, etc.).
- Replaced references to deleted files (`theme.tsx`, `tmux-border-theme.ts`) with the current equivalents.
- Left `server-types.ts` untouched: it is a transitional re-export with zero consumers and requires a human decision on whether to remove it.
