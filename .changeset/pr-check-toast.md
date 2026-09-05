---
"@sma1lboy/rove": patch
---

CI finishing on one of your tasks now says so, instead of only changing a chip

The daemon has polled `gh pr list` per task for a while, and it already wrote
`checkState` onto the task and pushed it to every client. Nothing in the TUI
ever read that field. So the only signal that a PR's checks had landed was the
sidebar chip changing colour — which you see if you happen to be looking at
that row, and which is exactly the wrong shape for the case the poller was
built for: four tasks in flight, you in the fifth.

Checks resolving now raise a toast naming the task, whether they passed or
failed, and which PR. Only the resolution is announced: a run that merely
started (no checks → pending) stays quiet, as does every flap in between, and a
task whose checks were already settled when the daemon came back does not
re-announce itself on restart. The rule was written and unit-tested when the
poller shipped (`checkResolutionNotify`); it had no subscriber until now.

Two call sites that were each deriving "is this task's repo a remote `ssh://`
project?" by hand — the engine launch builder and the workspace centre column —
now ask `remoteKeyForRepo`, the helper that was already written to be the one
place that decision is made.
