---
"@sma1lboy/rove": patch
---

Keep a new session unconfirmed when its launch shell retries repository initialization during the engine startup probe. A live PTY with an absent init marker no longer reports a failed launch; completed initialization and dead sessions retain their existing failure checks.
