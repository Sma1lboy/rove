---
"@sma1lboy/rove": patch
---

Make the ops verbs report what they actually did.

`pty.log` now carries the same ISO timestamps `daemon.log` does, and records
the signal that ended a host. A daemon's first log line names why it was
started — `explicit-restart`, `autospawn`, or `manual` — so a `rove daemon
restart` is no longer indistinguishable from a helper's autospawn. `rove
doctor` reports the PTY host's build alongside the daemon's and flags a host
older than the CLI, which a daemon restart can never replace. `rove reset`
now lists what `--hard` destroys (saved projects, custom engines, theme,
language, onboarding — the whole settings file, not just "UI state"), clears
the frozen-session store even when the host had to be signalled rather than
stopped gracefully, and exits 2 instead of 0 when it is run without a
terminal and without `--yes`. `rove update` says which background processes
are still running the old build, and warns about breaking versions during
`--dry-run` too. `rove adopt --vendor` rejects an unknown engine up front
instead of writing the typo onto every matched task. `rove doctor
--kill-orphans` records each process group it signals in `daemon.log`.
