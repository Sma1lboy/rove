---
"@sma1lboy/rove": patch
---

Stop reporting a daemon that is shutting down as healthy. `probeDaemonSocket` treated a hello that rejected the same as one that answered, so a probe landing in the shutdown window — where the daemon destroys every client socket — was told the daemon was fine and handed back a socket that vanished milliseconds later. A connection the peer drops before answering is now `absent`, so callers recover instead of using a dying socket. A daemon that answers with a protocol-mismatch error still counts as alive: it is running and serving other clients, and killing it is how split-brain starts.
