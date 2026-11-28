---
"@sma1lboy/rove": patch
---

[daemon] [cli] [tui] [web] Routines now support both time-driven (cron) and event-driven triggers (`ci_failed`, `pr_review_requested`, `issue_opened`, `webhook`, `local`) independently or combined, with `--event`/`--event-*` flags, `routine-emit` for local hooks, PR-poller transition triggers, and Schedule/Event mode UI in both TUI and web.
