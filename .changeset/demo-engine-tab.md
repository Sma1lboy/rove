---
"@sma1lboy/rove": patch
---

A demo engine (`demo`) opens a tab that replays a scripted Claude Code session — spinner, tool calls, a diff, a permission prompt, elapsed time and token counts — with no model and no network. It is off by default and hidden from the engine selector until `ROVE_DEMO_ENGINE=1` is set, so normal startup is unchanged; `ROVE_DEMO_SPEED` and `ROVE_DEMO_LOOP=0` tune playback. Useful for recording, screenshots, and showing Rove's shape on a machine with no engine installed.
