---
"@sma1lboy/rove": patch
---

Fix six visual defects across the TUI: three rail pages (Kanban, Routines,
Issues) swap the same content panel but each picked its own left inset, so
the body jumped sideways on every switch — they now share the x=2 inset the
sibling Versions/Worktrees pages already used, and their static page titles
render in the neutral text color instead of the accent, which on the default
palette is the same hue as the focus indicator.

The running-tab chip moves from `focusAccent` to the semantic `info` color:
several tabs can run at once, so painting them the focus hue drowned the
"you are here" signal. In transparent mode the condensed tab strip no longer
paints a row background (matching its own wide branch, and letting the host
wallpaper through), while the scrolled-back hint gains one — it is an overlay
you must read, and the panel token it used is forced to alpha-0. The sidebar's
"New task" row drops its vertical padding, returning two rows to the most
height-pressured panel in the product.

`visual:shot` gains `--width`/`--height` (narrow-layout captures),
`--wallpaper` (transparent-mode captures), and a `click:X,Y` token.
