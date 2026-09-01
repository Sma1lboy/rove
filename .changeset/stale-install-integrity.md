---
"@sma1lboy/rove": patch
---

Say so when Rove is running from an install that has been deleted

A `bun`/`node` process holds its entry open by inode, so uninstalling Rove out from under a running one leaves it alive on a path that no longer exists. It keeps working until it needs to spawn a daemon, and then fails identically forever — one GUI on the owner's machine spent two days in a reconnect loop that could never succeed, showing nothing but "reconnecting".

Three changes. The resolver now throws a distinguishable `StaleInstallError` instead of a generic message, so a permanent failure can be told apart from a transient one. The reconnect loop stops on it — retrying assumes the next attempt could differ, which it cannot here — and the workspace paints a banner naming the reinstall. And `rove doctor` gains an `install:` line that runs the spawn path's own resolver, so the two can never disagree.

Also fixes an ordering bug found alongside it: `ensureDaemonReachable` killed the existing daemon *before* resolving the entry point to replace it, so a stale install removed a working daemon it could not put back.
