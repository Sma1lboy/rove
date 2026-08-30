---
"@sma1lboy/rove": patch
---

Make four silent failures visible, and add a gate so the class can't come back

Each of these refused a user's action and said nothing on screen — under the alternate screen a bare `console.error` only reaches the daemon log, so the gesture looked like a no-op:

- Enter on a task whose worktree can't be materialized (first open after a restart, or the directory removed out of band) did nothing at all — the row never moved, so the only feedback was that pressing Enter again also did nothing. It now names which of the three cases it hit: the task is mid-delete, the project isn't a git repo yet (with the `git init` fix), or the underlying worktree error.
- The terminal's "shell could not start" pane was a dead end. F5 is advertised as the recovery key, but the reset path returned early when there was no live PTY — exactly the state a failed spawn leaves behind. F5 now retries (no confirm — there is no running shell to kill), and the pane says so.
- Switching engines from the `ctrl+e` picker showed the new tab whether or not the write landed, so a rejected switch was indistinguishable from success while the task silently kept its old engine. Both routes now share one helper and raise the same failure/success toasts.
- Kanban's story edit, status flip, and task link reported failures to the log only; the board then repainted from the store, so a rejected edit read as an edit that never happened.

Also retires four copy entries that were written but never rendered, and adds `scripts/no-silent-catch.mjs` (wired into CI) so a new bare `console.error` catch handler under `tui-react/**` fails the build instead of shipping. Deliberate cases take a `silent-catch-ok` marker.
