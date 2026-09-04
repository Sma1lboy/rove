---
"@sma1lboy/rove": patch
---

`rove doctor --report` stops dropping a bug bundle into your repo, and `get-task` documents the field that tells an engine from its shell

The report bundle now lands at `~/.rove/rove-doctor-report.txt`, beside the
`daemon.log` and `pty.log` it quotes and under the same `ROVE_HOME_DIR`
override. It used to be written into `process.cwd()`, which is where the
instruction "run `rove doctor --report` and attach the file" sends people: run
it inside a checkout and it left `rove-doctor-report.txt` untracked, matched by
no `.gitignore`, one reflexive `git add -A` from committing recent daemon logs
and environment. A fixed home path is also the same path every time, which is
what makes the printed location worth reading out over chat.

`docs/API.md` now names `engineAlive` in the `get-task` tab shape. Every tab
already carried it and the page never listed it, while spending a paragraph one
section down warning readers that a session outlives its engine — `alive: true,
engineAlive: false` is that hazard's per-tab answer, and an automation reading
the docs fell back to `collect` or its own `ps` walk for something one read had
already returned. Documented with the same three-valued rule `.running` gets:
`null` means nothing could look, never "no engine".

`docs/API.md` also explains why `api add --repo` accepts a `.scratch/` or
`$TMPDIR` checkout that `rove add` refuses: the eligibility gate governs what
may become a PROJECT, so `add --repo` still runs it and merely skips minting the
project row rather than failing the call.

`CONTEXT.md` stops describing `rove web` and a daemon "browser transport", both
removed in #855. The surviving sidecar is the harness one.
