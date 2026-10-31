---
"@sma1lboy/rove": patch
---

- `rove api ports` on Linux now prints an IPv6 listener's address the way it reads on macOS: a server bound to the IPv4-mapped loopback shows `::ffff:127.0.0.1` with a `http://localhost:PORT` url instead of the raw `::ffff:7f00:1`, and other IPv6 binds come back compressed (`fe80::1`, not `fe80:0:0:0:0:0:0:1`).
