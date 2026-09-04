---
"@sma1lboy/rove": patch
---

Routines: refuse a schedule that can never work, at the moment you create it.

`routine-create` accepted a repo that does not exist, a directory that is not a
git checkout, and a `--base-branch` that resolves to nothing. All three are
stored, listed, and then fail identically at every firing — which for a
`0 3 * * *` routine you find out tomorrow morning. Both are now checked when
the routine is saved, with a message naming the value; `routine-update
--base-branch` gets the same check. Remote (`ssh://`) projects are passed
through unprobed.

`routine-update --precheck-timeout 5` on its own used to return the routine
with its OLD timeout and no error — the flag was dropped before the call was
built. It is now refused with `--precheck-timeout requires --precheck`.

The Routines composer's repo picker offers your saved projects, not just the
repos your existing tasks sit in, so a project you have added but not yet
opened a task in can be scheduled.

`Automation.lastRunAt` is renamed `lastOccurrenceAt`. It was never the last
run: it is the occurrence the sweep consumed, stamped before dispatch and set
for skips too, so a routine that had only ever recorded `skipped_unavailable`
still reported a `lastRunAt` in `routine-list`. Existing `automations.json`
files keep their value.
