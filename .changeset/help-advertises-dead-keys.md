---
"@sma1lboy/rove": patch
---

F1 stops advertising keys that do nothing, and the Update page stops offering a downgrade

`HERE — only in <pane>` bypassed its own reachability test for rows with no
chord of their own, so a live engine tab listed four diff-review keys with no
diff on screen (pressing `j` typed a `j` into the engine) plus four composer
keys belonging to the engine CLI, one of them a chord terminals cannot send.
Those rows now go through the same reachability scan as everything else: the
diff-review keys appear only while a diff is focused, the engine's composer
keys are gone from Rove's help entirely, and the New Task mode chord is
documented where it is true — on the dialog's own `MODE ctrl+[ ]` label.

The Update page offered "Update now" and pre-selected it whether or not there
was an update, so `enter` on a machine whose install was ahead of the published
release ran the installer and downgraded it. With nothing newer it now says so,
drops the action, and stops printing a backwards "changes from … to …" header
over a "release notes are unavailable" line.

The Files pane's Zen chip advertised `[~]`, a key bound to nothing; it now
resolves through the live keymap like the Create-PR chip beside it (`[⌃ A Z]`,
following a rebound prefix). F1's corner names the keys that scroll it — most
of its content sits below the fold behind a one-cell scrollbar thumb.
