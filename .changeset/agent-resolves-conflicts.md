---
"@sma1lboy/rove": patch
---

A task row's menu gains **Resolve conflicts with agent**. It runs the same merge as **Sync with base**, and when that merge stops on conflicts it hands the conflicted files to the task's engine as a prompt — resolve them, drop the markers, run the tests, commit the merge — instead of leaving them in a toast for you to work through by hand beside an agent that knows the branch. A worktree that merges clean or is already current says so and sends nothing; a dirty worktree is refused before the merge, as Sync is. The prompt can be replaced per repo with `.rove/conflict-instructions.md`, the same way `pr-instructions.md` and `ci-instructions.md` work. Retrying Sync while an earlier merge is still conflicted now reports the conflict again instead of asking you to commit first, which a conflict makes impossible.
