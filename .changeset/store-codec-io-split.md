---
"@sma1lboy/rove": patch
---

Move `readDiskTasks` and `mergeWithDisk` from `orchestrator/index/store.ts` into `store-codec.ts` as stateless I/O helpers. This relocates the disk-read and three-way merge logic to the existing `this`-independent codec module rather than leaving it on the mutable store class. `store.ts` drops from 498 to 432 lines; `store-codec.ts` remains under the 500-line cap.
