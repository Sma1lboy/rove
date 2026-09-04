---
"@sma1lboy/rove": patch
---

The sidebar's right-click menu now shows the chord each verb already has.

Every entry that mirrors a keyboard verb rendered as a bare label, so the one
surface where a mouse user meets these verbs taught none of the keys that reach
them: `Rename` never said `r`, `Open in editor` never said `o`, `Delete` never
said `d`. The caps come from `legendCap()` — the same live-keymap resolver the
sidebar chips and the F1 rows use — so rebinding `sidebar.rename` to `ctrl+y`
prints `⌃ Y` and unbinding `tasks.cycleEngine` drops `Change engine`'s cap
rather than advertising a dead key.

Entries with no binding at all stay bare, which is now a statement instead of an
accident: `Set status`, `Copy branch name`, `Copy path`, `Run again`,
`Field notes` and `Sync with base` reach nothing from the keyboard, and the
blank right-hand column is where you can see that.
