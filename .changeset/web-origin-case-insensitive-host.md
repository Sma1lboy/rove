---
"@sma1lboy/rove": patch
---

Fix the harness PTY sidecar rejecting browser requests with a 403 when `KOBE_WEB_HOST` contains uppercase letters, such as `MyMac.local`. Compare the allowed bind hostname case-insensitively with the URL parser's normalized Origin hostname while continuing to reject other hosts.
