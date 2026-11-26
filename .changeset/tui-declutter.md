---
"@sma1lboy/rove": patch
---

- The terminal UI's task list shows a row's state at the end of the row, at the list's edge as the web does, instead of before the title.
- The terminal UI's task list is quieter: a row no longer shows how long it has been running or waiting, a child task no longer wears a shared/own-worktree mark, and a project name stands without a rule after it.
- The bottom bar no longer shows the session's token total.
- The task list's header reads like the web's: the `[ rove ]` wordmark on the left and `inbox 3` on the right.
- A child task hangs off its parent on a `└` line.
- A task on another machine no longer wears a cloud, which most terminal fonts lack and drew off the row's line. Where it runs (`on win · v0.9.301`) shows while the mouse is over the row, and a machine that is offline says so on the row.
- The New task row ends in a plain `+`; its key no longer sits beside it.
- The task list no longer marks a pull request's checks or conflicts on its row; the web still does, and a finished or failed check still raises its notice.
- A task's state is a 3×3 grid of dots at the very end of its row, the web's mark: a ripple while it works, the full grid when it waits on you, a cross for an error, a tick for a finished turn you have not seen, a muted ring at rest. The starburst and ASCII glyph presets keep their one glyph and leave a quiet row bare. The header has a blank line under it.
