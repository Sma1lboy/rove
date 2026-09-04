---
"@sma1lboy/rove": patch
---

A task index mutation that reported failure no longer lands on disk minutes
later. `create`/`update`/`move` apply to the in-memory cache first and persist
second, and never undid the cache change when the write failed — so the id
stayed dirty and the next unrelated successful save flushed it. Measured, with
the index lock held past the 5s deadline: `rove api rename` exited 1 while
`get-task` reported the new title, and one unrelated `rove add` later disk
carried it too; a `rove add` that exited 1 was listed immediately and appeared
on disk the same way. For `add --prompt` that is a task materialising after the
caller gave up, with no worktree, no branch and no engine. Now the failed
mutation is reverted and the caller's error is the whole story: the same runs
report exit 1, the old title everywhere, and a disk count that moves by one
instead of two.

Two smaller halves of the same disagreement, in the same file. A store never
dropped a task a peer deleted: the merge correctly omitted it from the bytes
but folded the result into the cache additively, so the process listed a
phantom row forever and kept writing a file without it — the eviction is now
part of the fold, and subscribers hear about it. And `store.remove()` on an id
the cache never saw returned `void`, making "deleted" and "there was nothing
here" the same answer; it returns a boolean. It still does not throw the way
`update`/`move` do, because the daemon replays a queued deletion after a
restart and a replay finding nothing is success.

Rove also refuses to start a second daemon on a home another daemon already
serves, naming the socket that owns it. The daemon singleton is keyed on the
socket path, not the home, and the ownership guard watches only its own path —
so overriding `ROVE_DAEMON_SOCKET_PATH` while leaving `ROVE_HOME_DIR` alone
(what the harness and capture isolation recipes do) put two daemons on one
state root, each invisible to the other. Their task lists diverged permanently,
the project-main row was written twice, and `automations.json` and
`.config/rove/state.json` were raced as well. The claim lives in
`<home>/.rove/daemon.owner`; liveness is decided by asking the recorded socket,
not by trusting a pid, so a crashed daemon's claim never blocks a restart.
