---
"@sma1lboy/rove": patch
---

**The user docs now match what the code does, in seven places they had drifted
from.** The sidebar row stopped drawing the board status when the PR chip
collapsed to three glyphs, but CONCEPTS still promised a status mark; the
`ctrl+a p` table row described one chord as two actions when it is one handler
that follows focus; the row menu's chord-less entries were counted as "four"
and had grown to six; `KOBE_FILETREE_WATCH` never followed the rename to
`ROVE_`; and the welcome panel's engine line has been three readings — usable,
installed-but-signed-out, none — since it stopped calling a logged-out CLI
ready, while TUI said only "detected".

`--delete-branch` on `rove api delete` is now documented as what git actually
does: `git branch -d`, so it keeps a branch neither the repo's HEAD nor the
branch's upstream contains (work that was never pushed and never landed),
`--force` upgrades it to `-D`, and **the remote branch is never touched** in
any case. The outcome is in the daemon log, not the reply.
