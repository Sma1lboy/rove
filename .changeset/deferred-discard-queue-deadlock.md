---
"@sma1lboy/rove": patch
---

Fix a deadlock that wedged the deferred-prompt store, and with it every task deletion.

`discard()` returned the in-flight claim's promise bare from inside the store's write queue. `serialized()` runs `tail.then(fn)`, so the queue slot ADOPTED that promise: the slot could not settle until the claim did, while the claim's own `releaseClaim`/`markDelivered` were queued behind that same slot. A dismiss arriving during a delivery closed the cycle and no later operation on the store ever ran — `deleteTask` (and so `task.delete`) sat at `phase=running` indefinitely, and `rove api deferred-list` timed out.

The wait now happens outside the queue, exactly as `waitForClaims` already did: the enqueued callback hands the promise back wrapped and the wait runs after the slot has settled. Discard semantics are unchanged — it still waits for an in-flight claim before dropping the record.
