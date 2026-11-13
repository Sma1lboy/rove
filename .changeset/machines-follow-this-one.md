---
"@sma1lboy/rove": patch
---

Your other machines now keep up with this one. A registered machine that connects on an older Rove is updated from here on its own, once nothing is running in its Rove; it is never downgraded. Set `"machines.autoUpdate": false` in `state.json` to keep updating by hand with `rove machine update`.

Updating a machine no longer restarts its Rove when there was nothing newer to install.
