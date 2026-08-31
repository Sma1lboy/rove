---
"@sma1lboy/rove": patch
---

Stop `api delete` from reporting a refused or failed deletion as a successful one.

Every outcome returned the same empty object: a queued deletion, a refusal, and a removal that failed in the background were indistinguishable on the wire. A batch cleanup could report 21 successes while leaving worktrees behind, and the only record of the failure was a line in `daemon.log` the caller never sees.

The reply now carries `queued` (was the request scheduled at all) and `status`. New `--wait` follows the background removal to its outcome — `removed`, or `failed` with git's own error message — so a script deleting a list of tasks can tell which ones actually went.
