---
"@sma1lboy/rove": patch
---

The daemon's `/api/engines` route no longer invents a lone Claude entry when no engine is available. That synthesized row overwrote the web dashboard's own four-built-in fallback, so on a machine with no detected engine, or with every engine switched off in Settings, every vendor picker collapsed to Claude with no way to reach the rest. An empty list now stays empty and the New Task dialog offers all four built-ins again.
