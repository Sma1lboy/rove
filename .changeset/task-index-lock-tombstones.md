---
"@sma1lboy/rove": patch
---

Fix two concurrency holes in the shared task-index write path. The index lockfile is now created atomically (content-first sidecar + link) and carries a per-acquire token, so a reader can never observe a half-written lock and classify a live holder as stale, two stores in the same process are distinguishable holders, and release can no longer unlink a lock a rival legitimately took over — closing the mutual-exclusion break behind the `rename tasks.json.tmp ENOENT` CI flake (#53); each save also stages through a unique tmp file so writers can't clobber each other's staging even under a broken mutex. Deletions are now persisted as tombstones in `tasks.json` (optional `removed` field, pruned after 30 days), so a peer instance that still holds a deleted task dirty in memory can no longer resurrect it on its next save (#47).
