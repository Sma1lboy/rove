---
"@sma1lboy/rove": patch
---

Call each thing by one name: docs, F1, and pane hints now agree

Four places where the same feature had two names — or a doc promised
something that no longer exists — are straightened out:

- The sidebar's `a` key no longer has a documented action: the archived view
  it drove retired with issue #75, and the keybindings page still listed
  "Archive non-main Task". The same doc page now uses `n`/`d`/`r` as its
  bare-letter examples instead of the retired `a`.
- The page, the sidebar nav, and `ctrl+a` `2` all say "Routines"; the F1
  guide and the prefix command map said "automations". Both now say
  "routines".
- The Files pane's first-use hint taught `h`/`l` as "fold", which collides
  with the sidebar's promise that nothing ever folds. It now says
  "collapse", matching the binding's own description.
- The Inbox footer taught `d` as "delete", but the action clears a
  notification without confirming — unlike every other `d`, which deletes
  with a confirm. It now says "clear", matching the Inbox section of the
  keybindings doc and the F1 description.
