---
"@sma1lboy/rove": patch
---

Signing out (or revoking a device) now ends the WebSocket that device still holds, and the page returns to the sign-in screen; request bodies past 2 MiB are refused before they are buffered.
