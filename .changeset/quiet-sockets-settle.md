---
"@sma1lboy/rove-plugin-sdk": patch
---

Settle pending socket requests when a plugin closes or loses its connection. Reconnecting the same client isolates the new connection from late socket events, and invalid JSON frame shapes no longer crash plugin subscribers.
