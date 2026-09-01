---
"@sma1lboy/rove": patch
---

`land --delete-branch` no longer reports a deletion it did not perform. git refuses to delete a branch a live worktree has checked out, so pairing `--delete-branch` with `--remove-worktree=false` — or with a removal that got refused for a dirty tree, the base checkout, or the caller's own worktree — left the branch in place while the land reported success. The branch deletion is now gated on the worktree actually being gone, and a land that keeps the branch says so in the result's new `branchKept` field with the reason. It also no longer returns a `branchAnchor` naming a salvage ref for a branch nothing deleted.
