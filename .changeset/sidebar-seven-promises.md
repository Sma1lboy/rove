---
"@sma1lboy/rove": patch
---

Make the sidebar tree show seven things it already knew

Each of these was a fact the tree had in hand and did not draw, so the row
looked the same as a row where nothing was wrong.

- **Every task row prints the digit that jumps to it.** The `ctrl+<digit>`
  chord worked; the number was a thing you had to count out. Rows now carry
  it at the right edge, starting at `2` — `ctrl+1` has no encoding in the
  legacy terminal protocol, so the first row shows the digit that actually
  works instead of one that does nothing.
- **A failed deletion is visible on the worktree row.** The deletion
  coordinator sweeps a task's PTYs before it touches the worktree, so by the
  time a deletion fails the task has no activity and no live tab — and the
  tab row that would have carried the mark is gated on activity it can never
  have again. A stalled deletion was discoverable only through
  `rove api list`. The worktree row now draws `!` for a failed deletion and
  spins while one is in flight, beside a `deleting` / `delete failed` word.
- **A turn whose engine is still writing no longer reads as done.** The
  daemon's transcript facts reach the tree rows, which is what separates a
  finished turn from one where `turn-complete` fired and a long tool call ran
  on in hook silence — measured at nine minutes on a real session, the whole
  of which the row spent claiming it was idle.
- **A freeze-restored tab is distinguishable from a quiet one.** When the pty
  host dies it keeps each session's scrollback and marks the process gone;
  opening such a tab silently re-runs its recorded launch command. The row
  wore `○`, the one glyph that means "nothing to do here". It now wears `!`.
- **A `pty.kill` that never reaches the host leaves a trace.** Closing a tab
  this process holds no handle for was a bare `catch {}` documented as "the
  same outcome as the kill succeeding". It is not: a kill that lands drops
  the freeze record, and a miss leaves it on disk for the next host to thaw —
  the tab you closed comes back with its engine running, which is the one
  thing `docs/SESSIONS.md` promises cannot happen. The miss is now recorded
  with its session key.

Also: `anyRowLoading`'s docstring described itself as the gate the sidebar
uses to park its spinner timer, which a per-row subscription store replaced —
it has no caller, and wiring it to anything today would freeze the spinner
under a still-working row, because it cannot see the transcript. Four
`Sidebar` props nothing reads are gone.
