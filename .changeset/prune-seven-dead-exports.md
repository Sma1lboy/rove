---
"@sma1lboy/rove": patch
---

Delete seven exported helpers that nothing called. Four were in the TUI package (a combined protocol sniff wrapper, a theme-mode setter that duplicated the live context method, a best-effort orchestrator connect, and a one-line sidebar id mapper), and three in the daemon and web dashboard (an environment-variable delete helper, a board card accessor, and a command palette open that callers reached through the toggle instead). No behavior changes: every remaining path already went through the live equivalents.
