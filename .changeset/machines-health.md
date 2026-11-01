---
"@sma1lboy/rove": patch
---

The web app lists a Machines page once a machine is registered: each machine's state and version, and for one that is not connected, why (nothing answers SSH, the name does not resolve, the key was refused, Rove is missing there, the link dropped…) and the `rove machine doctor` to run. A machine whose probe failed but whose sockets were known no longer goes offline without a reason.
