---
"@sma1lboy/rove": patch
---

Stop treating a slow `hello` as a dead daemon. A busy daemon that missed the
3s probe deadline was killed and replaced, which made the old one self-stop
when it saw a new socket inode, which dropped every client, which made every
GUI reconnect at once onto a cold-starting daemon — eleven successions in one
50-minute window, with `rove api` failing intermittently throughout. The
client now asks the OS whether the daemon PROCESS exists before stopping
anything, and GUI reconnects are jittered so they no longer arrive in lockstep.
