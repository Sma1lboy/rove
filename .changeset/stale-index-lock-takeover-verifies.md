---
"@sma1lboy/rove": patch
---

A stale task-index lock is no longer removable by an acquirer that stopped holding it.

The takeover read the lockfile, judged its pid dead, then unlinked
unconditionally — never re-checking that the file still held the value it
judged. A rival that won the takeover in between had its live lock deleted, and
the next `link` admitted a second writer to the critical section. Measured on 50
concurrent acquires against one stale lock: 29 of 2250 created tasks were absent
from disk (22 of 45 rounds), against 0 of 2250 with no stale lock present. The
takeover now removes only a byte-identical match, through the same ownership
check `release` performs, and it does so synchronously — the async pair's `await`
was itself a scheduling point wide enough for a rival's whole takeover.

Daemon boot also sweeps what a killed writer leaves in `.rove/`: a stale
`tasks.json.lock` (every one of 20 `kill -9` trials left one) and orphaned
`tasks.json.*.tmp` staging files, which are unique per save and so are never
reused or noticed — 1 of those 20 trials leaked a full 11.8 MB copy of the
manifest. A lock naming a live process and a staging file younger than five
minutes are left alone: another Rove may be mid-save.
