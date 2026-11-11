---
"@sma1lboy/rove": patch
---

Fix terminals of a task on another Linux machine failing to open with "daemon connection closed". That machine reported its terminal socket under `~/.rove` while it listened under `XDG_RUNTIME_DIR`, so the hub forwarded to a socket nobody served.
