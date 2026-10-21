---
"@sma1lboy/rove": patch
---

A machine can now decide what other machines' hubs may run on it. `rove machine inbound` shows the policy, and `rove machine inbound deny <class>` / `allow <class>` change it. Classes are the verb groups (`read`, `create`, `drive`, `lifecycle`, …) plus `land` for `land` and `publish`. Everything is allowed until denied. A refused forward returns `INBOUND_DENIED` with the class, the hub's hostname (now sent with every forwarded call) and the command that lifts it. The policy lives in that machine's own `state.json`.
