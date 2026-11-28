---
"@sma1lboy/rove": patch
---

[internal] The daemon test for "an exited child nobody reaped reads as dead" no longer fails at random on a busy CI runner: it now waits until the child's parent can no longer reap it before letting the child exit.
