---
"@sma1lboy/rove": patch
---

Report a half-completed worktree removal as what it is, instead of a total failure that cannot be retried.

`git worktree remove` deregisters the worktree's metadata and deletes its directory, and those two halves can fail apart: an unwritable path inside the tree (a `chmod -w` directory, a read-only dependency cache) makes the delete fail after the deregistration has already landed. Rove read git's exit code as the whole truth, so it reported total failure — and left no way forward, because every retry then hit `fatal: is not a working tree` and the task stayed parked in `deletion.phase = "error"` forever.

A removal that got that far now counts as done: the task is deleted, `land` still reports the land as landed, and a notice names the directory left on disk plus git's own reason. Retrying a removal on such a directory converges instead of throwing. Rove never deletes the leftover itself — whatever made it undeletable may be something you want.
