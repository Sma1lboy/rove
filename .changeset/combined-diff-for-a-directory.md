---
"@sma1lboy/rove": patch
---

`d` on a directory row in the Files pane now opens everything under it as one diff, in one tab. Reviewing a twelve-file attempt was twelve keypresses and twelve tabs; for a round of three siblings, thirty-six. The loader was always a git pathspec call — a directory produces exactly the multi-file diff the renderer already draws — so the only thing in the way was the guard that refused directory rows.

The Changes tab gains a `[D] diff everything` chip for the whole worktree, and a proposed `D` binding for the same (see `docs/design/keybinding-decisions.md`; the chip works with no chord either way).

Combined diffs are read-only: a review note anchors to a single path, so a diff spanning files carries none, and the footer says so rather than leaving the missing `c`/`v`/`x`/`s` looking broken. Per-file notes are unchanged. A directory with nothing changed in the active scope now says so instead of opening a blank pane.
