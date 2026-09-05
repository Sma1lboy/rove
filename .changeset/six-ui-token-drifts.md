---
"@sma1lboy/rove": patch
---

Six places where the UI had drifted from the vocabulary the rest of it already speaks

The narrow tab strip painted every turn state one colour, so `● running` and
`! error` differed only by glyph on a phone-width terminal. The chip now takes
the same tone the wide strip does — and sits outside the active-tab fill,
because on that orange fill the error red lands at a 1.02 contrast ratio.

The update and worktrees pages each had their own cursor row: a solid `primary`
bar and a `▸ ` prefix. Both now use the shared row chrome, so the cursor is the
same `▌` everywhere and transparent mode stops painting opaque patches onto the
host wallpaper. `▸` also goes back to meaning only "collapsed", which is what it
means in the sidebar and the file tree.

The right-click menu now reads `backgroundMenu` — a token every bundled theme
defines and nothing read — so the popup separates from the panel it covers
instead of sharing its exact fill. The set-branch dialog's field takes the
shared dialog label and well. The update and versions pages drop a scrollbar
track no other page draws. And the `q / esc` close hint in those two page
headers is translated, like the title beside it.
