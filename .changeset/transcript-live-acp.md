---
"@sma1lboy/rove": patch
---

[web] [tui] [cli] [daemon] Chat tab now streams incremental transcript updates via bridge push events (hook events and history file watching, keeping polling as fallback) and includes an inline composer that submits prompts to the active engine tab via `rove api send`. Added a generic ACP (`agent-client-protocol`) engine adapter (`engineProtocol.<id> = "acp"` and plugin `protocol = "acp"`) with JSON-RPC stdio transport, structured session history, turn completion markers, and OSC 7501 activity reporting without per-CLI screen scraping.
