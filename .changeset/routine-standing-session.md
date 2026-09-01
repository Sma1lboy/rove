---
"@sma1lboy/rove": patch
---

Give a routine the option of one standing session, and fold its tasks behind a count row in the sidebar.

`rove api routine-create --persistent-session` re-delivers each firing into ONE task instead of creating a fresh worktree and branch every time, so a daily check can build on what it said yesterday. It stays off by default and is per-routine: a routine that edits code still wants a clean branch per run, since a week of runs piled onto one branch is a branch nobody can land. Seven daily routines were otherwise 49 sidebar rows a week.

Those tasks now rest behind a per-project `N routine sessions` row — `enter` opens it, `enter` again closes it. This is the one fold in a tree that has none by design, and it is scoped to match: it hides only what a schedule created, never a task you opened. A folded task is still found by `/`, still opens from the Routines page, and still raises an Inbox entry when its turn ends — which is how last night's report reaches you.

Two run statuses come with it, because the degraded paths must not read as a clean run. `revived` means the engine had exited and was respawned in the same worktree: the files carried over, the conversation did not. `deferred` means the composer was busy, so the prompt is queued in your Inbox rather than dropped — a routine's report going missing is indistinguishable from one that never ran. A standing task that gets deleted is rebuilt on the next firing instead of wedging the routine forever.
