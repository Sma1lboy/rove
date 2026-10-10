---
"@sma1lboy/rove": patch
---

Engines that report their own state with OSC 7501 (Claude Code 2.1.295+) now
drive the sidebar badge, attention inbox and phone status directly, including
for tabs no TUI has open. Hook reports still win; screen reading is the
fallback. OSC 3008 context is parsed and kept.
