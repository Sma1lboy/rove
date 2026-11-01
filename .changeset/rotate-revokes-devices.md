---
"@sma1lboy/rove": patch
---

`rove --web --rotate-token` now signs out every device as it promised. Before, it replaced only the shared token, so phones paired with `--device` and browsers signed in with the web password kept working.
