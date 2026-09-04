---
"@sma1lboy/rove": patch
---

The PR-status poller's 30s interval is now the rate you actually get

One pass awaited each `gh pr list` in turn, and the ticker drops any tick
arriving while a pass is still running — so the real per-task refresh was
`max(30s, N × gh_latency)` while `DEFAULT_PR_STATUS_POLL_MS` and the module doc
both said 30s. A pass now runs up to `PR_POLL_CONCURRENCY` (8) calls at once.
Measured through the real `spawn` path with a counting shim at 800ms per call:
18 tasks 15.2s → 2.6s, 50 tasks 42.1s → 5.9s, 200 tasks 169.5s → 21.5s, with
peak concurrency going from 1 to 8 and the same number of `gh` children spawned.
At 50 tasks the effective refresh was 42s and is now the documented 30s.

This matters past a stale chip: `prStatus` is the only CI truth Rove holds, and
an unattended worker asks it whether its own PR is green. The tick, the jitter,
and the per-task backoffs are unchanged — only the pass was serial, and `gh`
waits on the network rather than the CPU, so serialising it was never buying
back the subprocess budget its comment claimed.
