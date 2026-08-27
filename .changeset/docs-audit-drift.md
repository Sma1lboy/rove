---
"@sma1lboy/rove": patch
---

Docs audit: verify every checkable claim in the user-facing pages against
source and fix ~60 drifted assertions — the `~/.kobe` → `~/.rove` runtime
paths in TROUBLESHOOTING/SESSIONS/CLI/CONFIGURATION, the dead `ctrl+a y`
resume-picker chord (removed from KEYBINDINGS/ENGINES/SESSIONS/TUI), stale
CLI flags and undocumented aliases, `rove api` group/flag mismatches, the
inverted editor precedence, the four-column Kanban, the kimi transcript
layout, and the plugin event-support matrix (Kimi wires more hooks than
documented). Fixes the one dead link on the docs site (WORK-TRACKING →
gitignored HANDOFF.md) and adds two TROUBLESHOOTING entries users actually
hit: `rove api send` refusing with NO_ENGINE_TAB/ENGINE_NOT_RUNNING, and
duplicate daemons after upgrading across the 0.8.189 path move.
