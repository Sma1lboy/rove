---
"@sma1lboy/rove": patch
---

Runtime and plugin files move out of `~/.kobe` into `~/.rove`. The daemon and
PTY host now write their sockets, pidfiles and logs under the product's own
state dir, and an existing plugin install is moved across the first time the
new daemon starts — the rename reached the data layout months ago but left
every runtime path behind, so a machine running Rove kept growing a directory
named after the old product. A legacy socket is still honoured while the
process holding it is alive, because a socket path is an address, not a
preference: switching it out from under a running PTY host would orphan every
engine tab it owns.
