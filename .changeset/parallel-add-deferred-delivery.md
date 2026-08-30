---
"@sma1lboy/rove": patch
---

Fix `add --count`/`--agents` reporting a deferred sibling as a delivery failure. A parallel round only accepted `delivered === true` as success, so a sibling whose prompt was accepted-but-deferred (issue #78 B-layer: the composer was briefly busy, the daemon took ownership of the message and queued an inbox episode) landed in the failure list, tripped `PARTIAL_FANOUT`, and exited non-zero — even though the single-task `add` and `send` paths both treat a deferred delivery as a success the caller must NOT retry. The round now routes a deferred sibling to the success rows with its `deferred` marker, so a scripted fan-out no longer sees a phantom failure and can't double-deliver the same message.
