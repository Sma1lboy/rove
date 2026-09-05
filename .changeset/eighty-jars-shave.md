---
"@sma1lboy/rove": patch
---

Three places where Rove decided something was ready before it was.

`rove api add` on a repo with a `.rove/init.sh` no longer reports
`SESSION_FAILED` — quoting `bun install`'s progress bar as the reason — for a
task that goes on to start normally. Repo init records its exit code in a
per-worktree marker; a marker left empty by an older release meant "re-run
init" to the launch shell and "init already finished" to the CLI, so the CLI
spent its engine probe against a shell that was still installing dependencies.
Both sides now read the marker the same way.

`rove api read-output --source terminal` without `--tab` finds an engine that
is running on a tab other than tab-1 when the task launches through a wrapper
command (`claudecpa`, any custom preset). It was searching the live sessions
for the task's *vendor* binary rather than the task's own, and answered "no
live terminal session for this task" while `--tab tab-2` returned a live tail.

The daemon no longer answers `Cannot access 'handlers' before initialization`
to a client that connects during the last moments of its startup — the socket
now starts accepting only once the request path is complete. This showed up as
Rove exiting 1 on roughly one launch in five on a busy machine.
