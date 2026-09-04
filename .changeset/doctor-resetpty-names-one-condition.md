---
"@sma1lboy/rove": patch
---

`doctor.fix.resetPty` names the condition that actually fired.

The label read "the PTY host is unreachable or not running" — two conditions,
so it was true whichever one produced it. Since a host that is merely not
running no longer proposes anything, the surviving case is the other one, and
the label now says so: "the PTY host process is alive but its socket is
unreachable (wedged)". It matches the shape of `resetDaemonWedged`, which was
already specific.
