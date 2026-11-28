---
"@sma1lboy/rove": patch
---

[web][cli] Upgrade the desktop app's side-panel browser from an iframe to a native Electron WebContentsView with persistent session cookies, real back/forward navigation, and graceful iframe fallback in browser-only `rove --web` mode. Add `rove api web <tab|nav|snap|batch|eval|fetch|handoff>` over local IPC for compact accessibility snapshots (`--interactive --root @eN`), direct automation, and live human-agent tab handoff.
